import { newId } from "@/lib/ids";

export const OWNER_COOKIE = "asd_owner";
const OWNER_RE = /^o_[0-9a-z]{16}$/;

/** Anonymous identity: keep a valid existing id, otherwise mint a new one. */
export function ensureOwnerId(existing: string | undefined | null): { id: string; isNew: boolean } {
  if (existing && OWNER_RE.test(existing)) return { id: existing, isNew: false };
  return { id: newId("o", 16), isNew: true };
}

/** Hash an IP for rate limiting so raw IPs are never stored. */
export async function hashIp(ip: string, salt = process.env.IP_SALT ?? "atoms-story-demo"): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest).slice(0, 12))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
