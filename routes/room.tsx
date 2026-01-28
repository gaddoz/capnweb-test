import { Hono } from "jsr:@hono/hono";
import { RpcTarget, newWebSocketRpcSession } from "npm:capnweb@0.4.0"; // match README/server example
import { Layout } from "../views/layout.tsx";
import { RoomPage } from "./room-page.tsx";
import { TodoFragment } from "../views/todo-fragment.tsx";

type Todo = { id: string; text: string; done: boolean; createdAt: number };

// Client-provided capability (a “remote object”)
type RoomWatcher = {
  roomChanged(version: number): void;
};

type Room = {
  id: string;
  version: number;
  todos: Todo[];
  watchers: Set<RoomWatcher>;
};

const rooms = new Map<string, Room>();

function getRoom(id: string): Room {
  let r = rooms.get(id);
  if (!r) {
    r = { id, version: 0, todos: [], watchers: new Set() };
    rooms.set(id, r);
  }
  return r;
}

function notifyRoomChanged(room: Room) {
  room.version++;
  console.log(
    "[notify]",
    room.id,
    "v",
    room.version,
    "watchers",
    room.watchers.size,
  );

  for (const w of Array.from(room.watchers)) {
    Promise.resolve(w.roomChanged(room.version)).catch((e) => {
      console.log("[notify] watcher failed -> removing", e);
      room.watchers.delete(w);
      try {
        w[Symbol.dispose]?.();
      } catch {}
    });
  }
}

/** Cap’n Web API */
class RootApi extends RpcTarget {
  joinRoom(roomId: string) {
    return new RoomApi(roomId);
  }
}

class RoomApi extends RpcTarget {
  constructor(private roomId: string) {
    super();
  }

  watch(watcher: any) {
    const room = getRoom(this.roomId);

    // IMPORTANT: parameter stubs are auto-disposed when the call returns.
    // Dup it to keep beyond this call. :contentReference[oaicite:1]{index=1}
    const keep = watcher.dup();

    room.watchers.add(keep);
    console.log("[watch] added", this.roomId, "count", room.watchers.size);

    // Optional initial ping; handle rejection explicitly
    Promise.resolve(keep.roomChanged(room.version)).catch((e) => {
      console.log("[watch] initial ping failed -> removing", e);
      room.watchers.delete(keep);
    });
  }
}

const app = new Hono();

app.get("/", (c) => c.redirect("/room/demo"));

app.get("/room/:roomId", (c) => {
  const roomId = c.req.param("roomId");
  return c.html(
    <Layout title={`Shared Todos • ${roomId}`}>
      <RoomPage roomId={roomId} />
    </Layout>,
  );
});

app.get("/_frag/room/:roomId/list", (c) => {
  const room = getRoom(c.req.param("roomId"));
  return c.html(<TodoFragment room={room} />);
});

// htmx actions (same as before) — just swap notifyRoomChanged()
app.post("/_action/room/:roomId/add", async (c) => {
  const room = getRoom(c.req.param("roomId"));
  const body = await c.req.parseBody();
  const text = String(body["text"] ?? "").trim();
  if (text) {
    room.todos.unshift({
      id: crypto.randomUUID(),
      text,
      done: false,
      createdAt: Date.now(),
    });
    console.log("post add", room.id);
    notifyRoomChanged(room);
  }
  return c.html(<TodoFragment room={room} />);
});

app.post("/_action/room/:roomId/toggle/:todoId", (c) => {
  const room = getRoom(c.req.param("roomId"));
  const todoId = c.req.param("todoId");
  const t = room.todos.find((x) => x.id === todoId);
  if (t) {
    t.done = !t.done;
    notifyRoomChanged(room);
  }
  return c.html(<TodoFragment room={room} />);
});

app.post("/_action/room/:roomId/remove/:todoId", (c) => {
  const room = getRoom(c.req.param("roomId"));
  const todoId = c.req.param("todoId");
  const before = room.todos.length;
  room.todos = room.todos.filter((x) => x.id !== todoId);
  if (room.todos.length !== before) notifyRoomChanged(room);
  return c.html(<TodoFragment room={room} />);
});

/**
 * Cap’n Web WebSocket endpoint.
 * Client connects here and gets RootApi stub.
 */
const sessions = new WeakMap<WebSocket, unknown>();

app.get("/api", (c) => {
  const { socket, response } = Deno.upgradeWebSocket(c.req.raw);
  socket.addEventListener("open", () => {
    sessions.set(socket, newWebSocketRpcSession(socket, new RootApi()));
  });
  socket.addEventListener("close", () => sessions.delete(socket));
  socket.addEventListener("error", () => sessions.delete(socket));
  return response;
});

export default app;
