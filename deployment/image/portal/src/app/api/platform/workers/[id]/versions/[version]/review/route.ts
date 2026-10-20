import { platformApi, jsonBody } from "@/lib/studio/guard";
import { recordReview, StudioError } from "@/lib/studio/store";

/** A human reviews exactly the spec they saw: { decision, specHash, checklist, note }. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string; version: string }> }) {
  const g = await platformApi();
  if ("res" in g) return g.res;
  const { id, version } = await ctx.params;
  const v = Number(version);
  if (!Number.isInteger(v) || v < 1) return Response.json({ error: "Not found." }, { status: 404 });
  const b = await jsonBody<{ decision?: unknown; specHash?: unknown; checklist?: unknown; note?: unknown }>(req);
  if (!b || (b.decision !== "approve" && b.decision !== "reject") || typeof b.specHash !== "string" || !b.checklist || typeof b.checklist !== "object") {
    return Response.json({ error: "Send { decision, specHash, checklist }." }, { status: 400 });
  }
  try {
    await recordReview(g.op, id, v, { decision: b.decision, specHash: b.specHash, checklist: b.checklist as Record<string, boolean>, note: typeof b.note === "string" ? b.note : "" });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof StudioError) return Response.json({ error: e.message, problems: e.problems }, { status: e.status });
    throw e;
  }
}
