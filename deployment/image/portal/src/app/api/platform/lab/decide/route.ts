import { jsonBody, platformApi } from "@/lib/studio/guard";
import { labDecide, PERSONAS, type PersonaKey } from "@/lib/studio/lab";

/** Lets an approver persona decide an approval a test run created: { approvalId, persona, decision, reason }. */
export async function POST(req: Request) {
  const g = await platformApi();
  if ("res" in g) return g.res;
  const b = await jsonBody<{ approvalId?: unknown; persona?: unknown; decision?: unknown; reason?: unknown }>(req);
  if (!b || typeof b.approvalId !== "string" || !PERSONAS.some((p) => p.key === b.persona) || (b.decision !== "approve" && b.decision !== "decline")) return Response.json({ error: "Send { approvalId, persona, decision }." }, { status: 400 });
  const r = await labDecide(g.op, { approvalId: b.approvalId, persona: b.persona as PersonaKey, decision: b.decision, reason: typeof b.reason === "string" ? b.reason : "" });
  return Response.json(r.body, { status: r.status });
}
