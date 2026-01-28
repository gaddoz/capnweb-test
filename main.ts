import app from "./routes/room.tsx";

Deno.serve((req) => app.fetch(req));
