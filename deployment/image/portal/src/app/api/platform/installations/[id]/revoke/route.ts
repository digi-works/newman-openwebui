import { jsonBody, platformApi } from "@/lib/studio/guard";
import { revokeInstallation } from "@/lib/studio/installations";
import { StudioError } from "@/lib/studio/store";

/** Revokes a customer stack's access to the Release Service. A stack that lost its key is revoked and re-enrols with a new token. Platform admins only. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await platformApi("platform_admin");
  if ("res" in g) return g.res;
  const b = await jsonBody<{ reason?: unknown }>(req);
  try {
    await revokeInstallation(g.op, (await ctx.params).id, typeof b?.reason === "string" ? b.reason : "");
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof StudioError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
