import { RpcTarget, newWebSocketRpcSession } from "npm:capnweb@0.4.0";
import type { RoomWatcher } from "./types.ts";
import { addWatcher } from "./room_watch.ts";

export class RootApi extends RpcTarget {
  joinRoom(roomId: string) {
    return new RoomApi(roomId);
  }
}

export class RoomApi extends RpcTarget {
  constructor(private readonly roomId: string) {
    super();
  }

  async watch(watcher: RoomWatcher) {
    // IMPORTANT: dup() so it survives after the call returns
    const keep = (watcher as any).dup();
    await addWatcher(this.roomId, keep);
  }
}

const sessions = new WeakMap<WebSocket, unknown>();

export function mountCapnWebWs(c: { req: { raw: Request } }) {
  const { socket, response } = Deno.upgradeWebSocket(c.req.raw);

  socket.addEventListener("open", () => {
    sessions.set(socket, newWebSocketRpcSession(socket, new RootApi()));
  });

  socket.addEventListener("close", () => sessions.delete(socket));
  socket.addEventListener("error", () => sessions.delete(socket));

  return response;
}
