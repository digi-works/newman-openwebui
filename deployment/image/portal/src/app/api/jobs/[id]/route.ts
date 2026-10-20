import { getJob } from "@/lib/jobs/engine";
import { hasPermission, P } from "@/lib/permissions";
import { getSessionUser } from "@/lib/session";

/** The state of a job. Its owner can see it, and so can people who decide approvals. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || user.mustChangePassword) return Response.json({ error: "Please sign in again." }, { status: 401 });
  const job = await getJob(user.tenantId, (await ctx.params).id);
  if (!job || (job.actorUserId !== user.id && !hasPermission(user.permissions, P.approvalsDecide))) return Response.json({ error: "Not found." }, { status: 404 });
  const { id, type, status, error, attempts, createdAt, completedAt, result } = job;
  return Response.json({ id, type, status, error, attempts, createdAt, completedAt, result });
}
