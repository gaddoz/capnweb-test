export function RoomPage(props: { roomId: string }) {
  const roomId = props.roomId;

  // Tiny “true island” (no hydration): opens WS + triggers htmx refresh on push
  const islandCode = `
    const roomId = ${JSON.stringify(roomId)};
    const wsUrl = (() => {
      const u = new URL(location.href);
      u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
      u.pathname = "/ws/room/" + encodeURIComponent(roomId);
      u.search = "";
      u.hash = "";
      return u.toString();
    })();

    const ws = new WebSocket(wsUrl);

    ws.addEventListener("message", (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "changed") {
          window.htmx.ajax("GET",
            "/_frag/room/" + encodeURIComponent(roomId) + "/list",
            { target: "#todo-list", swap: "innerHTML" }
          );
        }
      } catch {}
    });
  `;

  return (
    <div>
      <header>
        <h1>Shared Todo Room</h1>
        <div class="muted">
          Room <code>{roomId}</code> — open in 2 tabs and watch live sync
        </div>
      </header>

      <div class="card">
        <h2 style="margin-top:0;">Add a todo</h2>
        <form
          class="row"
          hx-post={`/_action/room/${encodeURIComponent(roomId)}/add`}
          hx-target="#todo-list"
          hx-swap="innerHTML"
        >
          <input type="text" name="text" placeholder="e.g. buy milk" required />
          <button type="submit">Add</button>
        </form>
        <div class="muted" style="margin-top:8px;">
          Actions are <code>htmx</code> POSTs returning HTML fragments. Live
          updates are WS push → fragment refresh.
        </div>
      </div>

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

      <div class="card">
        <h2 style="margin-top:0;">Talking points</h2>
        <ul>
          <li>No hydration. No client framework.</li>
          <li>Server renders HTML (full pages + fragments).</li>
          <li>htmx handles actions and swaps fragments.</li>
          <li>A tiny island listens to WS pushes and triggers htmx refresh.</li>
        </ul>
      </div>

      <script type="module" dangerouslySetInnerHTML={{ __html: islandCode }} />
    </div>
  );
}
