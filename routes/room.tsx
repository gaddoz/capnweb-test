import { Hono } from "jsr:@hono/hono";
import { RpcTarget, newWebSocketRpcSession } from "npm:capnweb@0.4.0";
import { Layout } from "../views/layout.tsx";
import { RoomPage } from "./room-page.tsx";
import { TodoFragment } from "../views/todo-fragment.tsx";
const ADMIN_BOOTSTRAP_KEY = "discgolf";

const kv = await Deno.openKv(); // on Deploy this uses built-in KV :contentReference[oaicite:3]{index=3}

type RoomRecord = { version: number; todos: Todo[] };

async function kvGetRoom(roomId: string): Promise<RoomRecord> {
  const res = await kv.get<RoomRecord>(["room", roomId]);
  return res.value ?? { version: 0, todos: [] };
}

async function kvSetRoom(roomId: string, rec: RoomRecord) {
  await kv.set(["room", roomId], rec);
}

type Todo = { id: string; text: string; done: boolean; createdAt: number };

type Role = "viewer" | "editor" | "admin";

type Invite = {
  roomId: string;
  role: Role;
  expiresAt: number;
  usesLeft?: number; // optional
};

function base64Url(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  const b64 = btoa(s);
  return b64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function randomToken(bytes = 24) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return base64Url(arr);
}

async function mintInvite(
  roomId: string,
  role: Role,
  ttlMs: number,
  usesLeft?: number,
) {
  const token = randomToken(32);
  const inv: Invite = { roomId, role, expiresAt: Date.now() + ttlMs, usesLeft };
  await kv.set(["invite", token], inv);
  return token;
}

async function getInvite(
  token: string | undefined | null,
): Promise<Invite | null> {
  if (!token) return null;
  const res = await kv.get<Invite>(["invite", token]);
  const inv = res.value;
  if (!inv) return null;
  if (Date.now() > inv.expiresAt) {
    await kv.delete(["invite", token]);
    return null;
  }
  return inv;
}

async function consumeInvite(token: string): Promise<Invite | null> {
  const res = await kv.get<Invite>(["invite", token]);
  const inv = res.value;
  if (!inv) return null;

  if (Date.now() > inv.expiresAt) {
    await kv.delete(["invite", token]);
    return null;
  }

  if (inv.usesLeft != null) {
    inv.usesLeft--;
    if (inv.usesLeft <= 0) {
      await kv.delete(["invite", token]);
    } else {
      await kv.set(["invite", token], inv);
    }
  }

  return inv;
}

function getOrigin(req: Request) {
  const url = new URL(req.url);
  const host =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto =
    req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

function parseCookies(cookieHeader: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join("=") ?? "");
  }
  return out;
}

function setCapCookie(c: any, token: string) {
  // Demo-friendly cookie: HttpOnly so JS can’t read it, but browser sends it on htmx posts + WS upgrades.
  // Add Secure automatically if https:
  const isHttps = new URL(c.req.url).protocol === "https:";
  const cookie =
    `mw_cap=${encodeURIComponent(token)}; Path=/; SameSite=Lax; HttpOnly` +
    (isHttps ? "; Secure" : "");
  c.header("Set-Cookie", cookie);
}

function roleAllowsEdit(role: Role) {
  return role === "editor" || role === "admin";
}

// --- Room store ---
type RoomWatcher = { roomChanged(version: number): void };

type Room = {
  id: string;
  watchers: Set<any>; // dup'ed capnweb watcher stubs
  watchStarted: boolean;
};

const rooms = new Map<string, Room>();

function LockedRoomPage(props: { roomId: string }) {
  return (
    <Layout title={`Locked • ${props.roomId}`}>
      <div class="card">
        <h1 style="margin-top:0;">Room locked</h1>
        <div class="muted">
          You need an invite link to access <code>{props.roomId}</code>.
        </div>

        <div class="card" style="margin-top:12px;">
          <h2 style="margin-top:0;">Enter with invite</h2>
          <div class="muted">
            Paste an invite URL (or just the token) and continue.
          </div>

          <form
            class="row"
            action={`/_action/room/${encodeURIComponent(props.roomId)}/enter`}
            method="post"
          >
            <input
              type="text"
              name="cap"
              placeholder="https://…/cap/ABC... or ABC..."
              required
            />
            <button type="submit">Enter</button>
          </form>
        </div>
      </div>
    </Layout>
  );
}

function getRoom(id: string): Room {
  let r = rooms.get(id);
  if (!r) {
    r = { id, watchers: new Set(), watchStarted: false };
    rooms.set(id, r);
  }
  return r;
}

function notifyRoomChanged(room: Room) {
  room.version += 1;

  for (const w of Array.from(room.watchers)) {
    Promise.resolve(w.roomChanged(room.version)).catch(() => {
      room.watchers.delete(w);
      try {
        w?.[Symbol.dispose]?.();
      } catch {}
    });
  }
}

async function ensureRoomWatch(roomId: string) {
  const room = getRoom(roomId);
  if (room.watchStarted) return;
  room.watchStarted = true;

  // kv.watch emits whenever the key changes :contentReference[oaicite:4]{index=4}
  (async () => {
    for await (const entries of kv.watch([["room", roomId]])) {
      const rec = entries[0]?.value as RoomRecord | null;
      if (!rec) continue;

      // notify local connected clients in THIS isolate
      for (const w of Array.from(room.watchers)) {
        Promise.resolve(w.roomChanged(rec.version)).catch(() => {
          room.watchers.delete(w);
          try {
            w?.[Symbol.dispose]?.();
          } catch {}
        });
      }
    }
  })();
}

// --- Cap’n Web API (watch only; roles enforced by cookie at HTTP layer) ---
class RootApi extends RpcTarget {
  joinRoom(roomId: string) {
    return new RoomApi(roomId);
  }
}

class RoomApi extends RpcTarget {
  constructor(private roomId: string) {
    super();
  }

  async watch(watcher: RoomWatcher) {
    await ensureRoomWatch(this.roomId);

    const room = getRoom(this.roomId);
    const keep = (watcher as any).dup(); // required to keep param beyond call (you already learned this)
    room.watchers.add(keep);

    const rec = await kvGetRoom(this.roomId);
    await keep.roomChanged(rec.version);
  }
}

const sessions = new WeakMap<WebSocket, unknown>();

// --- App ---
const app = new Hono();

app.get("/", (c) => c.redirect("/room/demo"));

// Resolve invite link: sets cookie, redirects to room
app.get("/cap/:token", async (c) => {
  const token = c.req.param("token");
  const inv = await consumeInvite(token);
  if (!inv) return c.text("Invite invalid or expired.", 404);

  setCapCookie(c, token);
  return c.redirect(`/room/${encodeURIComponent(inv.roomId)}`);
});

// Room page (SSR)
app.get("/room/:roomId", async (c) => {
  const roomId = c.req.param("roomId");

  const cookies = parseCookies(c.req.header("cookie") ?? null);
  const token = cookies["mw_cap"];
  const inv = await getInvite(token);

  if (!inv || inv.roomId !== roomId) {
    return c.html(<LockedRoomPage roomId={roomId} />, 403);
  }

  const rec = await kvGetRoom(roomId);
  const origin = getOrigin(c.req.raw);

  return c.html(
    <Layout title={`Shared Todos • ${roomId}`}>
      <RoomPage
        roomId={roomId}
        role={inv.role}
        origin={origin}
        myCapToken={token ?? null}
        roomVersion={rec.version}
      />
    </Layout>,
  );
});

app.post("/_action/room/:roomId/enter", async (c) => {
  const roomId = c.req.param("roomId");
  const body = await c.req.parseBody();
  const capRaw = String(body["cap"] ?? "").trim();

  // Allow either full URL ".../cap/<token>" or just "<token>"
  let token = capRaw;
  try {
    const u = new URL(capRaw);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[0] === "cap" && parts[1]) token = parts[1];
  } catch {
    // not a URL, treat as token
  }

  const inv = await consumeInvite(token);
  if (!inv || inv.roomId !== roomId) {
    return c.text("Invite invalid/expired or not for this room.", 403);
  }

  setCapCookie(c, token);
  return c.redirect(`/room/${encodeURIComponent(roomId)}`);
});

app.get("/bootstrap/:roomId", async (c) => {
  const roomId = c.req.param("roomId");

  if (!ADMIN_BOOTSTRAP_KEY)
    return c.text("ADMIN_BOOTSTRAP_KEY not configured.", 500);

  const key = new URL(c.req.url).searchParams.get("key") ?? "";
  if (key !== ADMIN_BOOTSTRAP_KEY) return c.text("Forbidden", 403);

  const token = await mintInvite(roomId, "admin", 24 * 60 * 60 * 1000);
  setCapCookie(c, token);
  console.log("me setting cookie token", token);
  return c.redirect(`/room/${encodeURIComponent(roomId)}`);
});

// Fragment: todo list
app.get("/_frag/room/:roomId/list", async (c) => {
  const roomId = c.req.param("roomId");
  const rec = await kvGetRoom(roomId);

  // your role lookup stays the same, but now uses await getInvite(...)
  const cookies = parseCookies(c.req.header("cookie") ?? null);
  const inv = await getInvite(cookies["mw_cap"]);
  const role: Role = inv && inv.roomId === roomId ? inv.role : "viewer";

  return c.html(
    <TodoFragment
      room={{ id: roomId, version: rec.version, todos: rec.todos }}
      role={role}
    />,
  );
});

// Action: add
app.post("/_action/room/:roomId/add", async (c) => {
  const roomId = c.req.param("roomId");

  const cookies = parseCookies(c.req.header("cookie") ?? null);
  const inv = await getInvite(cookies["mw_cap"]);
  const role: Role = inv && inv.roomId === roomId ? inv.role : "viewer";
  if (!roleAllowsEdit(role)) return c.text("Forbidden", 403);

  const body = await c.req.parseBody();
  const text = String(body["text"] ?? "").trim();

  const rec = await kvGetRoom(roomId);
  if (text) {
    rec.todos.unshift({
      id: crypto.randomUUID(),
      text,
      done: false,
      createdAt: Date.now(),
    });
    rec.version++;
    await kvSetRoom(roomId, rec); // triggers kv.watch in all isolates :contentReference[oaicite:6]{index=6}
  }

  return c.html(
    <TodoFragment
      room={{ id: roomId, version: rec.version, todos: rec.todos }}
      role={role}
    />,
  );
});

// Action: toggle
app.post("/_action/room/:roomId/toggle/:todoId", async (c) => {
  const roomId = c.req.param("roomId");
  const todoId = c.req.param("todoId");

  const cookies = parseCookies(c.req.header("cookie") ?? null);
  const inv = await getInvite(cookies["mw_cap"]);
  const role: Role = inv && inv.roomId === roomId ? inv.role : "viewer";

  if (!roleAllowsEdit(role)) return c.text("Forbidden", 403);

  const rec = await kvGetRoom(roomId);

  const t = rec.todos.find((x) => x.id === todoId);
  if (t) {
    t.done = !t.done;
    rec.version++;
    await kvSetRoom(roomId, rec);
  }

  return c.html(
    <TodoFragment
      room={{ id: roomId, version: rec.version, todos: rec.todos }}
      role={role}
    />,
  );
});

// Action: remove
app.post("/_action/room/:roomId/remove/:todoId", async (c) => {
  const roomId = c.req.param("roomId");
  const todoId = c.req.param("todoId");
  const rec = await kvGetRoom(roomId);

  const cookies = parseCookies(c.req.header("cookie") ?? null);
  const inv = await getInvite(cookies["mw_cap"]);
  const role: Role = inv && inv.roomId === roomId ? inv.role : "viewer";

  if (!roleAllowsEdit(role)) return c.text("Forbidden", 403);

  const before = rec.todos.length;
  rec.todos = rec.todos.filter((x) => x.id !== todoId);

  if (rec.todos.length !== before) {
    rec.version++;
    await kvSetRoom(roomId, rec);
  }

  return c.html(
    <TodoFragment
      room={{ id: roomId, version: rec.version, todos: rec.todos }}
      role={role}
    />,
  );
});

// Admin: mint invite link (returns small HTML fragment)
app.post("/_action/room/:roomId/invite", async (c) => {
  const roomId = c.req.param("roomId");

  const cookies = parseCookies(c.req.header("cookie") ?? null);
  const inv = await getInvite(cookies["mw_cap"]);
  const role: Role = inv && inv.roomId === roomId ? inv.role : "viewer";

  if (role !== "admin") {
    return c.html(
      <div class="muted">Only admin can create invite links.</div>,
      403,
    );
  }

  const body = await c.req.parseBody();
  const wanted = String(body["role"] ?? "viewer") as Role;
  const ttl = String(body["ttl"] ?? "3600"); // seconds
  const ttlSec = Number.isFinite(Number(ttl))
    ? Math.max(60, Number(ttl))
    : 3600;

  const token = await mintInvite(roomId, wanted, ttlSec * 1000);
  const link = `${getOrigin(c.req.raw)}/cap/${token}`;

  return c.html(
    <div>
      <div class="muted">
        Invite created ({wanted}, {ttlSec}s):
      </div>
      <div style="margin-top:6px;">
        <input
          type="text"
          readonly
          value={link}
          style="width: 100%; padding:10px 12px; border-radius:10px; border:1px solid #ccc;"
          onclick="this.select()"
        />
      </div>
      <div class="muted" style="margin-top:6px;">
        Tip: click the box to select, then copy.
      </div>
    </div>,
  );
});

// Cap’n Web WS endpoint
app.get("/api", (c) => {
  const { socket, response } = Deno.upgradeWebSocket(c.req.raw);

  socket.addEventListener("open", () => {
    // keep session alive
    sessions.set(socket, newWebSocketRpcSession(socket, new RootApi()));
  });

  socket.addEventListener("close", () => {
    sessions.delete(socket);
  });

  socket.addEventListener("error", () => {
    sessions.delete(socket);
  });

  return response;
});

export default app;
