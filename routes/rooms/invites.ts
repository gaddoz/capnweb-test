import type { Context } from "jsr:@hono/hono";
import { kv } from "./kv.ts";
import type { Invite, Role } from "./types.ts";

function base64Url(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCodePoint(b);
  const b64 = btoa(s);
  return b64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function randomToken(bytes = 24) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return base64Url(arr);
}

export async function mintInvite(
  roomId: string,
  role: Role,
  ttlMs: number,
  usesLeft?: number,
) {
  const token = randomToken(32);
  const inv: Invite = { roomId, role, expiresAt: Date.now() + ttlMs, usesLeft };
  await kv.set(["invite", token], inv);
  return token;
}

export async function getInvite(
  token: string | undefined | null,
): Promise<Invite | null> {
  if (!token) return null;
  const res = await kv.get<Invite>(["invite", token]);
  const inv = res.value;
  if (!inv) return null;
  if (Date.now() > inv.expiresAt) {
    await kv.delete(["invite", token]);
    return null;
  }
  return inv;
}

export async function consumeInvite(token: string): Promise<Invite | null> {
  const res = await kv.get<Invite>(["invite", token]);
  const inv = res.value;
  if (!inv) return null;

  if (Date.now() > inv.expiresAt) {
    await kv.delete(["invite", token]);
    return null;
  }

  if (inv.usesLeft != null) {
    inv.usesLeft--;
    if (inv.usesLeft <= 0) await kv.delete(["invite", token]);
    else await kv.set(["invite", token], inv);
  }

  return inv;
}

export function parseCookies(
  cookieHeader: string | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join("=") ?? "");
  }
  return out;
}

export function setCapCookie(c: Context, token: string) {
  const isHttps = new URL(c.req.url).protocol === "https:";
  const cookie =
    `mw_cap=${encodeURIComponent(token)}; Path=/; SameSite=Lax; HttpOnly` +
    (isHttps ? "; Secure" : "");
  c.header("Set-Cookie", cookie);
}

export function getOrigin(req: Request) {
  const url = new URL(req.url);
  const host =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto =
    req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}
