type Role = "viewer" | "editor" | "admin";

type Todo = { id: string; text: string; done: boolean; createdAt: number };
type Room = { id: string; version: number; todos: Todo[] };

export function TodoFragment(props: {
  readonly room: Room;
  readonly role: Role;
}) {
  const room = props.room;
  const canEdit = props.role === "editor" || props.role === "admin";

  return (
    <div>
      <div class="muted">
        Room <code>{room.id}</code> • version <code>{room.version}</code> •
        items <code>{room.todos.length}</code>
      </div>

      <div style="margin-top: 8px;">
        {room.todos.length === 0 ? (
          <div class="muted">No todos yet — add one!</div>
        ) : (
          room.todos.map((t) => (
            <div class="todo">
              <div class="row" style="gap:10px;">
                <input
                  type="checkbox"
                  checked={t.done}
                  disabled={!canEdit}
                  hx-post={`/_action/room/${encodeURIComponent(room.id)}/toggle/${encodeURIComponent(t.id)}`}
                  hx-target="#todo-list"
                  hx-swap="innerHTML"
                />
                <span class={t.done ? "done" : ""}>{t.text}</span>
              </div>

              <button
                type="button"
                disabled={!canEdit}
                hx-post={`/_action/room/${encodeURIComponent(room.id)}/remove/${encodeURIComponent(t.id)}`}
                hx-target="#todo-list"
                hx-swap="innerHTML"
                aria-label="Remove todo"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>

      {canEdit === false ? (
        <div class="muted" style="margin-top:10px;">
          Viewer mode: live updates enabled, editing disabled.
        </div>
      ) : null}
    </div>
  );
}
