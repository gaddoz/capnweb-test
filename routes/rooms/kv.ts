import type { RoomRecord } from "./types.ts";

export const kv = await Deno.openKv();

export async function kvGetRoom(roomId: string): Promise<RoomRecord> {
  const res = await kv.get<RoomRecord>(["room", roomId]);
  return res.value ?? { version: 0, todos: [] };
}

export async function kvSetRoom(roomId: string, rec: RoomRecord) {
  await kv.set(["room", roomId], rec);
}
