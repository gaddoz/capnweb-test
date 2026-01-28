import { Layout } from "../../views/layout.tsx";

export function NewRoomPage() {
  return (
    <Layout title="Create a private room">
      <div class="card">
        <h1 style="margin-top:0;">Create a private room</h1>
        <div class="muted">
          You’ll get an admin invite link. Anyone with that link can administer
          the room.
        </div>

        <form class="row" action="/new" method="post" style="margin-top:12px;">
          <input
            type="text"
            name="name"
            placeholder="optional room name (e.g. demo)"
          />
          <button type="submit">Create room</button>
        </form>

        <div class="muted" style="margin-top:8px;">
          Rooms are private by default. Access is via invite links.
        </div>
      </div>
    </Layout>
  );
}
