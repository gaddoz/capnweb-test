export function RoomPage(props: { roomId: string }) {
  const roomId = props.roomId;

  const islandCode = `
    import { RpcTarget, newWebSocketRpcSession } from "https://esm.sh/capnweb@0.4.0?target=es2022";

    const roomId = ${JSON.stringify(roomId)};

    const wsUrl = (() => {
      const u = new URL(location.href);
      u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
      u.pathname = "/api";
      u.search = "";
      u.hash = "";
      return u.toString();
    })();

    class Watcher extends RpcTarget {
      roomChanged(version) {
        console.log("[capnweb] roomChanged", roomId, version);
        window.htmx.ajax(
          "GET",
          "/_frag/room/" + encodeURIComponent(roomId) + "/list",
          { target: "#todo-list", swap: "innerHTML" }
        );
      }
    }

    (async () => {
      console.log("[capnweb] connect", wsUrl);
      const root = newWebSocketRpcSession(wsUrl);
      const room = await root.joinRoom(roomId);
      await room.watch(new Watcher());
      console.log("[capnweb] watching", roomId);
    })();
  `;

  return (
    <div>
      <header>
        <h1>Shared Todo Room</h1>
        <div class="muted">
          Room <code>{roomId}</code>
        </div>
      </header>

      <div class="card">
        <form
          class="row"
          hx-post={`/_action/room/${encodeURIComponent(roomId)}/add`}
          hx-target="#todo-list"
          hx-swap="innerHTML"
          hx-on--after-request="console.log('yo');if(event.detail.successful) this.reset()"
        >
          <input type="text" name="text" required placeholder="" />
          <button type="submit">Add</button>
        </form>
      </div>

      <div class="card">
        <div
          id="todo-list"
          hx-get={`/_frag/room/${encodeURIComponent(roomId)}/list`}
          hx-trigger="load"
          hx-swap="innerHTML"
        >
          Loading…
        </div>
      </div>

      <script type="module" dangerouslySetInnerHTML={{ __html: islandCode }} />
    </div>
  );
}
