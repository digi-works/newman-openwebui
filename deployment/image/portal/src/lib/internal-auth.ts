import { timingSafeEqual } from "node:crypto";

/**
 * The internal API is for Open WebUI tools only. It needs PORTAL_INTERNAL_KEY and is blocked at the public tunnel.
 * To rotate the key without downtime: set the new value in PORTAL_INTERNAL_KEY and keep the old one in PORTAL_INTERNAL_KEY_PREVIOUS,
 * update the tool valves (scripts/install-digi-tools.py), then remove the previous key.
 */
const same = (a: string, b: string) => b.length >= 16 && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function internalAuthorized(req: Request): boolean {
  const got = req.headers.get("x-internal-key") || "";
  return same(got, process.env.PORTAL_INTERNAL_KEY || "") || same(got, process.env.PORTAL_INTERNAL_KEY_PREVIOUS || "");
}
