import { Layout } from "../../views/layout.tsx";

export function LockedRoomPage(props: { readonly roomId: string }) {
  return (
    <Layout title={`Locked • ${props.roomId}`}>
      <div class="card">
        <h1 style="margin-top:0;">Room locked</h1>
        <div class="muted">
          You need an invite link to access <code>{props.roomId}</code>.
        </div>

        <div class="card" style="margin-top:12px;">
          <h2 style="margin-top:0;">Enter with invite</h2>
          <div class="muted">
            Paste an invite URL (or just the token) and continue.
          </div>

          <form
            class="row"
            action={`/_action/room/${encodeURIComponent(props.roomId)}/enter`}
            method="post"
          >
            <input
              type="text"
              name="cap"
              placeholder="https://…/cap/ABC... or ABC..."
              required
            />
            <button type="submit">Enter</button>
          </form>
        </div>
      </div>
    </Layout>
  );
}
