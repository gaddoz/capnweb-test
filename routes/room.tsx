import { Hono } from "jsr:@hono/hono";
import { Layout } from "../views/layout.tsx";
import { RoomPage } from "./room-page.tsx";
import { TodoFragment } from "../views/todo-fragment.tsx";

type Todo = { id: string; text: string; done: boolean; createdAt: number };
type Room = {
  id: string;
  version: number;
  todos: Todo[];
  sockets: Set<WebSocket>;
};

const rooms = new Map<string, Room>();

function getRoom(id: string): Room {
  let r = rooms.get(id);
  if (!r) {
    r = { id, version: 0, todos: [], sockets: new Set() };
    rooms.set(id, r);
  }
  return r;
}

function broadcastRoomChanged(room: Room) {
  room.version += 1;
  const payload = JSON.stringify({
    type: "changed",
    roomId: room.id,
    version: room.version,
  });

  for (const ws of Array.from(room.sockets)) {
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
      else room.sockets.delete(ws);
    } catch {
      room.sockets.delete(ws);
    }
  }
}

const app = new Hono();

// Home
app.get("/", (c) => c.redirect("/room/demo"));

// Full page SSR
app.get("/room/:roomId", (c) => {
  const roomId = c.req.param("roomId");
  return c.html(
    <Layout title={`Shared Todos • ${roomId}`}>
      <RoomPage roomId={roomId} />
    </Layout>,
  );
});

// Fragment SSR (used by htmx swaps + WS invalidation refresh)
app.get("/_frag/room/:roomId/list", (c) => {
  const roomId = c.req.param("roomId");
  const room = getRoom(roomId);
  return c.html(<TodoFragment room={room} />);
});

// Action: add
app.post("/_action/room/:roomId/add", async (c) => {
  const roomId = c.req.param("roomId");
  const room = getRoom(roomId);

  const body = await c.req.parseBody();
  const text = String(body["text"] ?? "").trim();

  if (text) {
    room.todos.unshift({
      id: crypto.randomUUID(),
      text,
      done: false,
      createdAt: Date.now(),
    });
    broadcastRoomChanged(room);
  }

  return c.html(<TodoFragment room={room} />);
});

// Action: toggle
app.post("/_action/room/:roomId/toggle/:todoId", (c) => {
  const roomId = c.req.param("roomId");
  const todoId = c.req.param("todoId");
  const room = getRoom(roomId);

  const t = room.todos.find((x) => x.id === todoId);
  if (t) {
    t.done = !t.done;
    broadcastRoomChanged(room);
  }

  return c.html(<TodoFragment room={room} />);
});

// Action: remove
app.post("/_action/room/:roomId/remove/:todoId", (c) => {
  const roomId = c.req.param("roomId");
  const todoId = c.req.param("todoId");
  const room = getRoom(roomId);

  const before = room.todos.length;
  room.todos = room.todos.filter((x) => x.id !== todoId);
  if (room.todos.length !== before) {
    broadcastRoomChanged(room);
  }

  return c.html(<TodoFragment room={room} />);
});

// WebSocket endpoint: join a room and receive “changed” push events
app.get("/ws/room/:roomId", (c) => {
  const roomId = c.req.param("roomId");
  const room = getRoom(roomId);

  const { socket, response } = Deno.upgradeWebSocket(c.req.raw);

  socket.addEventListener("open", () => {
    room.sockets.add(socket);
    // optional: send a hello
    socket.send(
      JSON.stringify({ type: "hello", roomId: room.id, version: room.version }),
    );
  });

  socket.addEventListener("close", () => {
    room.sockets.delete(socket);
  });

  socket.addEventListener("error", () => {
    room.sockets.delete(socket);
  });

  return response;
});

export default app;
