import type { Context } from "jsr:@hono/hono";
import { Layout } from "../../views/layout.tsx";
import { RoomPage } from "../room-page.tsx";
import { NewRoomPage } from "./new_page.tsx";
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

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function shortId() {
  return crypto.randomUUID().split("-")[0];
}

export function makeHandlers() {
  return {
    home: (c: Context) => c.redirect("/new"),

    // NEW: public page
    newRoomPage: (c: Context) => c.html(<NewRoomPage />),

    // NEW: create private room + mint admin capability link
    createRoom: async (c: Context) => {
      const body = await c.req.parseBody();
      const name = String(body["name"] ?? "").trim();
      const base = name ? slugify(name) : "room";
      const roomId = `${base}-${shortId()}`;

      // Mint an admin invite and set it as cookie for creator
      const token = await mintInvite(roomId, "admin", 7 * 24 * 60 * 60 * 1000);
      setCapCookie(c, token);

      // Show admin link once on landing
      return c.redirect(`/room/${encodeURIComponent(roomId)}?created=1`);
    },

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

      // Only show the admin link box if arriving from /new (created=1) AND you are admin.
      const created = new URL(c.req.url).searchParams.get("created") === "1";
      const adminLink =
        created && inv.role === "admin" && token
          ? `${origin}/cap/${token}`
          : null;

      return c.html(
        <Layout title={`Shared Todos • ${roomId}`}>
          <RoomPage
            roomId={roomId}
            role={inv.role}
            origin={origin}
            myCapToken={token ?? null}
            roomVersion={rec.version}
            adminLink={adminLink}
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
