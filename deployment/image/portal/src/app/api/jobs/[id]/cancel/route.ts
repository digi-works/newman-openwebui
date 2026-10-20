import { cancelJob, getJob } from "@/lib/jobs/engine";
import { hasPermission, P } from "@/lib/permissions";
import { getSessionUser } from "@/lib/session";

/** Cancels a job that has not finished. Its owner can, and so can people who decide approvals. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || user.mustChangePassword) return Response.json({ error: "Please sign in again." }, { status: 401 });
  const id = (await ctx.params).id;
  const job = await getJob(user.tenantId, id);
  if (!job || (job.actorUserId !== user.id && !hasPermission(user.permissions, P.approvalsDecide))) return Response.json({ error: "Not found." }, { status: 404 });
  const out = await cancelJob(user.tenantId, id, user.id, "Cancelled by a person.");
  return Response.json({ id, status: out?.status ?? job.status });
}
