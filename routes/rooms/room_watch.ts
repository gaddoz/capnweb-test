import { kv, kvGetRoom } from "./kv.ts";
import type { RoomRecord } from "./types.ts";

type Room = {
  id: string;
  watchers: Set<any>;
  watchStarted: boolean;
};

const rooms = new Map<string, Room>();

function getRoom(id: string): Room {
  let r = rooms.get(id);
  if (!r) {
    r = { id, watchers: new Set(), watchStarted: false };
    rooms.set(id, r);
  }
  return r;
}

export async function ensureRoomWatch(roomId: string) {
  const room = getRoom(roomId);
  if (room.watchStarted) return;
  room.watchStarted = true;

  (async () => {
    for await (const entries of kv.watch([["room", roomId]])) {
      const rec = entries[0]?.value as RoomRecord | null;
      if (!rec) continue;

      for (const w of Array.from(room.watchers)) {
        Promise.resolve(w.roomChanged(rec.version)).catch(() => {
          room.watchers.delete(w);
          try {
            w?.[Symbol.dispose]?.();
          } catch {}
        });
      }
    }
  })();
}

export async function addWatcher(roomId: string, watcherStub: any) {
  await ensureRoomWatch(roomId);
  const room = getRoom(roomId);
  room.watchers.add(watcherStub);

  const rec = await kvGetRoom(roomId);
  await watcherStub.roomChanged(rec.version);
}
