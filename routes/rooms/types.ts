export type Todo = {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
};

export type Role = "viewer" | "editor" | "admin";

export type Invite = {
  roomId: string;
  role: Role;
  expiresAt: number;
  usesLeft?: number;
};

export type RoomRecord = { version: number; todos: Todo[] };

export type RoomWatcher = { roomChanged(version: number): void };

export function roleAllowsEdit(role: Role) {
  return role === "editor" || role === "admin";
}
