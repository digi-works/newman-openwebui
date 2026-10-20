import { jsonBody, platformApi } from "@/lib/studio/guard";
import { revokeRelease } from "@/lib/studio/releases";
import { StudioError } from "@/lib/studio/store";

/** Revokes a release: stacks learn of it from the signed revocation list and will not newly activate it. Platform admins only. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await platformApi("platform_admin");
  if ("res" in g) return g.res;
  const b = await jsonBody<{ reason?: unknown }>(req);
  if (!b || typeof b.reason !== "string" || !b.reason.trim()) return Response.json({ error: "Give a reason." }, { status: 400 });
  try {
    await revokeRelease(g.op, (await ctx.params).id, b.reason);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof StudioError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
