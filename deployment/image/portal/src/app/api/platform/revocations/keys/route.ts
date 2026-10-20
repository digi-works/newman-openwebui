import { jsonBody, platformApi } from "@/lib/studio/guard";
import { importKeyRevocation } from "@/lib/studio/releases";
import { StudioError } from "@/lib/studio/store";
import type { KeyRevocation } from "@/lib/release/verify";

/** Imports a root-signed key revocation (made at the key ceremony with scripts/studio-keys.mjs revoke-key). A forged entry is refused. */
export async function POST(req: Request) {
  const g = await platformApi("platform_admin");
  if ("res" in g) return g.res;
  const b = await jsonBody<Record<string, unknown>>(req);
  if (!b || typeof b.key_id !== "string" || typeof b.root_signature !== "string" || typeof b.revoked_at !== "string" || typeof b.root_key_id !== "string") {
    return Response.json({ error: "Send the revocation printed by the key ceremony." }, { status: 400 });
  }
  try {
    await importKeyRevocation(g.op, { key_id: b.key_id, reason: String(b.reason ?? ""), revoked_at: b.revoked_at, root_key_id: b.root_key_id, root_signature: b.root_signature } satisfies KeyRevocation);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof StudioError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
