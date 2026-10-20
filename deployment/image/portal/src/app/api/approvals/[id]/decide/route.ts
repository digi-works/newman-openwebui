import { ApprovalError, decideApproval } from "@/lib/approvals";
import { getSessionUser } from "@/lib/session";

/** Approve or decline an action that was waiting for another person. Never your own request, and only once. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || user.mustChangePassword) return Response.json({ error: "Please sign in again." }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { decision?: unknown; reason?: unknown };
  if (b.decision !== "approve" && b.decision !== "decline") return Response.json({ error: "Choose approve or decline." }, { status: 400 });
  try {
    return Response.json(await decideApproval(user, (await ctx.params).id, b.decision, typeof b.reason === "string" ? b.reason : ""));
  } catch (e) {
    if (e instanceof ApprovalError) return Response.json({ error: e.message }, { status: e.status });
    console.error("deciding an approval failed", e);
    return Response.json({ error: "Could not save the decision." }, { status: 502 });
  }
}
