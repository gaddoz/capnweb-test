import { Hono, type Context } from "jsr:@hono/hono";
import { makeHandlers } from "./rooms/handlers.tsx";
import { mountCapnWebWs } from "./rooms/capn_api.ts";

const h = makeHandlers();

const app = new Hono();

// home -> create room
app.get("/", (c: Context) => h.home(c));

// public create room
app.get("/new", (c: Context) => h.newRoomPage(c));
app.post("/new", (c: Context) => h.createRoom(c));

app.get("/cap/:token", (c: Context) => h.cap(c));
app.get("/room/:roomId", (c: Context) => h.roomPage(c));
app.post("/_action/room/:roomId/enter", (c: Context) => h.enter(c));

app.get("/_frag/room/:roomId/list", (c: Context) => h.fragList(c));

app.post("/_action/room/:roomId/add", (c: Context) => h.add(c));
app.post("/_action/room/:roomId/toggle/:todoId", (c: Context) => h.toggle(c));
app.post("/_action/room/:roomId/remove/:todoId", (c: Context) => h.remove(c));
app.post("/_action/room/:roomId/invite", (c: Context) => h.invite(c));

// Cap’n Web WS endpoint
app.get("/api", (c: Context) => mountCapnWebWs(c));

export default app;
