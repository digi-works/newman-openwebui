import fs from "node:fs";
import path from "node:path";
import type { TrustAnchor } from "./verify";

/**
 * The root public keys this build trusts. They ship inside the image (trust/*.json) and are the only thing a customer stack needs to verify a
 * release. Replacing the root is a deliberate act (a new image), never something a release or a network response can do.
 */
let cached: TrustAnchor[] | null = null;
export function trustedRoots(): TrustAnchor[] {
  if (cached) return cached;
  const dir = process.env.TRUST_DIR || path.join(process.cwd(), "trust");
  const out: TrustAnchor[] = [];
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      try { const a = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); if (a.key_id && a.public_key && a.alg === "ES256") out.push(a); } catch { /* skip */ }
    }
  }
  return (cached = out);
}
