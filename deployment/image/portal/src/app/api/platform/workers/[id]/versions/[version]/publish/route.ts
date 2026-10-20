import { platformApi } from "@/lib/studio/guard";
import { publishVersion, StudioError } from "@/lib/studio/store";

/** Publishes an approved version: freezes it and resolves its dependency lock. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string; version: string }> }) {
  const g = await platformApi();
  if ("res" in g) return g.res;
  const { id, version } = await ctx.params;
  const v = Number(version);
  if (!Number.isInteger(v) || v < 1) return Response.json({ error: "Not found." }, { status: 404 });

  try {
    return Response.json({ ok: true, lock: await publishVersion(g.op, id, v) });
  } catch (e) {
    if (e instanceof StudioError) return Response.json({ error: e.message, problems: e.problems }, { status: e.status });
    throw e;
  }
}
