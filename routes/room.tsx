import { Hono, type Context } from "jsr:@hono/hono";
import { makeHandlers } from "./rooms/handlers.tsx";
import { mountCapnWebWs } from "./rooms/capn_api.ts";

const ADMIN_BOOTSTRAP_KEY = "discgolf";

const h = makeHandlers({ adminBootstrapKey: ADMIN_BOOTSTRAP_KEY });

const app = new Hono();

app.get("/", (c: Context) => h.home(c));

app.get("/cap/:token", (c: Context) => h.cap(c));
app.get("/room/:roomId", (c: Context) => h.roomPage(c));
app.post("/_action/room/:roomId/enter", (c: Context) => h.enter(c));
app.get("/bootstrap/:roomId", (c: Context) => h.bootstrap(c));

app.get("/_frag/room/:roomId/list", (c: Context) => h.fragList(c));

app.post("/_action/room/:roomId/add", (c: Context) => h.add(c));
app.post("/_action/room/:roomId/toggle/:todoId", (c: Context) => h.toggle(c));
app.post("/_action/room/:roomId/remove/:todoId", (c: Context) => h.remove(c));
app.post("/_action/room/:roomId/invite", (c: Context) => h.invite(c));

// Cap’n Web WS endpoint
app.get("/api", (c: Context) => mountCapnWebWs(c));

export default app;
