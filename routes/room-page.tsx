type Role = "viewer" | "editor" | "admin";

export function RoomPage(props: {
  roomId: string;
  role: Role;
  origin: string;
  myCapToken: string | null;
  roomVersion: number;
}) {
  const roomId = props.roomId;
  const role = props.role;

  // Cap’n Web watcher island: server calls roomChanged() -> htmx refresh fragment
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
      roomChanged(_version) {
        console.log('Watcher roomChanged with version',_version);
        window.htmx.ajax(
          "GET",
          "/_frag/room/" + encodeURIComponent(roomId) + "/list",
          { target: "#todo-list", swap: "innerHTML" }
        );
      }
    }

    (async () => {
      const root = newWebSocketRpcSession(wsUrl);
      const room = await root.joinRoom(roomId);
      await room.watch(new Watcher());
    })();
  `;

  return (
    <div>
      <header>
        <h1>Shared Todo Room</h1>
        <div class="muted">
          Room <code>{roomId}</code> • role <code>{role}</code>
        </div>
      </header>

      <div class="card">
        <h2 style="margin-top:0;">Add a todo</h2>
        <form
          class="row"
          hx-post={`/_action/room/${encodeURIComponent(roomId)}/add`}
          hx-target="#todo-list"
          hx-swap="innerHTML"
          hx-on--after-request="if(event.detail.successful) this.reset()"
        >
          <input type="text" name="text" placeholder="" required />
          <button type="submit" disabled={role === "viewer"}>
            Add
          </button>
        </form>

        {role === "viewer" ? (
          <div class="muted" style="margin-top:8px;">
            You have a viewer link — you’ll see live updates, but cannot edit.
          </div>
        ) : (
          <div class="muted" style="margin-top:8px;">
            You can edit. Open this page in 2 tabs (or share a link) and watch
            updates push live.
          </div>
        )}
      </div>

      {role === "admin" ? (
        <div class="card">
          <h2 style="margin-top:0;">Invite links (capabilities)</h2>

          <form
            class="row"
            hx-post={`/_action/room/${encodeURIComponent(roomId)}/invite`}
            hx-target="#invite-box"
            hx-swap="innerHTML"
          >
            <select
              name="role"
              style="padding:10px 12px; border-radius:10px; border:1px solid #ccc;"
            >
              <option value="viewer">viewer (read-only)</option>
              <option value="editor">editor (can edit)</option>
              <option value="admin">admin (can invite)</option>
            </select>

            <input
              type="text"
              name="ttl"
              value="3600"
              style="width:120px; padding:10px 12px; border-radius:10px; border:1px solid #ccc;"
              title="TTL seconds"
            />

            <button type="submit">Create invite</button>
          </form>

          <div class="muted" style="margin-top:8px;">
            TTL is in seconds (min 60). Invite link is a “capability URL”.
          </div>

          <div id="invite-box" style="margin-top:12px;" class="card">
            <div class="muted">No invite created yet.</div>
          </div>
        </div>
      ) : null}

      <div class="card">
        <h2 style="margin-top:0;">Todos</h2>
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
