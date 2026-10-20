/**
 * Tiny in-memory failure counter for sign-in attempts. One portal instance per customer, so memory is enough.
 * (If the portal is ever scaled to several instances, move this to a shared store.)
 */
type Entry = { count: number; resetAt: number };
const hits = new Map<string, Entry>();

export const WINDOW_MS = 15 * 60 * 1000;

function live(key: string): Entry | undefined {
  const e = hits.get(key);
  if (!e) return undefined;
  if (e.resetAt <= Date.now()) { hits.delete(key); return undefined; }
  return e;
}

/** Seconds until `key` may try again, or 0 when it is under the limit. */
export function blockedFor(key: string, limit: number): number {
  const e = live(key);
  return e && e.count >= limit ? Math.ceil((e.resetAt - Date.now()) / 1000) : 0;
}

export function recordFailure(key: string) {
  const e = live(key);
  if (e) e.count += 1;
  else {
    if (hits.size > 5000) hits.clear();
    hits.set(key, { count: 1, resetAt: Date.now() + WINDOW_MS });
  }
}

export function clear(key: string) {
  hits.delete(key);
}

/** Client address. Behind Cloudflare the real IP is in cf-connecting-ip. */
export function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
