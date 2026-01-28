import type { Context } from "jsr:@hono/hono";
import { Layout } from "../../views/layout.tsx";
import { RoomPage } from "../room-page.tsx";
import { TodoFragment } from "../../views/todo-fragment.tsx";
import type { Role } from "./types.ts";
import { roleAllowsEdit } from "./types.ts";
import { kvGetRoom, kvSetRoom } from "./kv.ts";
import {
  consumeInvite,
  getInvite,
  getOrigin,
  parseCookies,
  setCapCookie,
  mintInvite,
} from "./invites.ts";
import { LockedRoomPage } from "./pages.tsx";

export function makeHandlers(opts: { adminBootstrapKey: string }) {
  const ADMIN_BOOTSTRAP_KEY = opts.adminBootstrapKey;

  return {
    home: (c: Context) => c.redirect("/room/demo"),

    cap: async (c: Context) => {
      const token = c.req.param("token");
      const inv = await consumeInvite(token);
      if (!inv) return c.text("Invite invalid or expired.", 404);

      setCapCookie(c, token);
      return c.redirect(`/room/${encodeURIComponent(inv.roomId)}`);
    },

    roomPage: async (c: Context) => {
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
        <Layout title={`Capnweb Todos • ${roomId}`}>
          <RoomPage
            roomId={roomId}
            role={inv.role}
            origin={origin}
            myCapToken={token ?? null}
            roomVersion={rec.version}
          />
        </Layout>,
      );
    },

    enter: async (c: Context) => {
      const roomId = c.req.param("roomId");
      const body = await c.req.parseBody();
      const capRaw = String(body["cap"] ?? "").trim();

      let token = capRaw;
      try {
        const u = new URL(capRaw);
        const parts = u.pathname.split("/").filter(Boolean);
        if (parts[0] === "cap" && parts[1]) token = parts[1];
      } catch {}

      const inv = await consumeInvite(token);
      if (!inv || inv.roomId !== roomId) {
        return c.text("Invite invalid/expired or not for this room.", 403);
      }

      setCapCookie(c, token);
      return c.redirect(`/room/${encodeURIComponent(roomId)}`);
    },

    bootstrap: async (c: Context) => {
      const roomId = c.req.param("roomId");

      if (!ADMIN_BOOTSTRAP_KEY)
        return c.text("ADMIN_BOOTSTRAP_KEY not configured.", 500);

      const key = new URL(c.req.url).searchParams.get("key") ?? "";
      if (key !== ADMIN_BOOTSTRAP_KEY) return c.text("Forbidden", 403);

      const token = await mintInvite(roomId, "admin", 24 * 60 * 60 * 1000);
      setCapCookie(c, token);
      return c.redirect(`/room/${encodeURIComponent(roomId)}`);
    },

    fragList: async (c: Context) => {
      const roomId = c.req.param("roomId");
      const rec = await kvGetRoom(roomId);

      const cookies = parseCookies(c.req.header("cookie") ?? null);
      const inv = await getInvite(cookies["mw_cap"]);
      const role: Role = inv && inv.roomId === roomId ? inv.role : "viewer";

      return c.html(
        <TodoFragment
          room={{ id: roomId, version: rec.version, todos: rec.todos }}
          role={role}
        />,
      );
    },

    add: async (c: Context) => {
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
        await kvSetRoom(roomId, rec);
      }

      return c.html(
        <TodoFragment
          room={{ id: roomId, version: rec.version, todos: rec.todos }}
          role={role}
        />,
      );
    },

    toggle: async (c: Context) => {
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
    },

    remove: async (c: Context) => {
      const roomId = c.req.param("roomId");
      const todoId = c.req.param("todoId");

      const cookies = parseCookies(c.req.header("cookie") ?? null);
      const inv = await getInvite(cookies["mw_cap"]);
      const role: Role = inv && inv.roomId === roomId ? inv.role : "viewer";
      if (!roleAllowsEdit(role)) return c.text("Forbidden", 403);

      const rec = await kvGetRoom(roomId);
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
    },

    invite: async (c: Context) => {
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
      const ttl = String(body["ttl"] ?? "3600");
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
    },
  };
}
