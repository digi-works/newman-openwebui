import { auditEvent } from "./audit";
import { withTenant } from "./digi-db";
import { hasPermission, P } from "./permissions";
import type { SessionUser } from "./session";

/**
 * Approvals (M5.7/M5.8): when Authority says ASK, the action waits as a job with an approval record. A person with the approve permission
 * decides it here, never their own request. Deciding moves that one job on, exactly once: a second decision, or a decision on a job that was
 * cancelled meanwhile, is refused.
 */
export type ApprovalRow = { id: string; jobId: string; tool: string; summary: string; requestedBy: string; own: boolean; createdAt: string };
export class ApprovalError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

type Actor = Pick<SessionUser, "id" | "tenantId" | "permissions">;

export async function listPending(actor: Actor): Promise<ApprovalRow[]> {
  if (!hasPermission(actor.permissions, P.approvalsDecide)) throw new ApprovalError("You do not have permission to decide approvals.", 403);
  return withTenant(actor.tenantId, async (c) => {
    const { rows } = await c.query(
      `select a.id, a.job_id, a.tool, a.summary, a.requested_by, a.created_at, coalesce(u.name, 'An automation') as who
         from approvals a join jobs j on j.id = a.job_id left join users u on u.id = a.requested_by
        where a.status = 'pending' and j.status = 'waiting_approval' order by a.created_at`,
    );
    return rows.map((r): ApprovalRow => ({ id: r.id, jobId: r.job_id, tool: r.tool, summary: r.summary, requestedBy: r.who, own: r.requested_by === actor.id, createdAt: new Date(r.created_at).toISOString() }));
  });
}

export async function pendingApprovalCount(actor: Actor): Promise<number> {
  if (!hasPermission(actor.permissions, P.approvalsDecide)) return 0;
  return withTenant(actor.tenantId, async (c) => (await c.query("select count(*)::int as n from approvals a join jobs j on j.id = a.job_id where a.status = 'pending' and j.status = 'waiting_approval' and a.requested_by is distinct from $1", [actor.id])).rows[0].n as number);
}

export async function decideApproval(actor: Actor, id: string, decision: "approve" | "decline", reason: string): Promise<{ status: string }> {
  if (!hasPermission(actor.permissions, P.approvalsDecide)) throw new ApprovalError("You do not have permission to decide approvals.", 403);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApprovalError("That approval no longer exists.", 404);
  const note = reason.trim().slice(0, 1000);
  if (!note) throw new ApprovalError("Add a short reason for this decision.");
  return withTenant(actor.tenantId, async (c) => {
    const a = (await c.query("select * from approvals where id = $1 for update", [id])).rows[0];
    if (!a) throw new ApprovalError("That approval no longer exists.", 404);
    if (a.status !== "pending") throw new ApprovalError(`This was already ${a.status}.`, 409);
    if (a.requested_by === actor.id) throw new ApprovalError("You cannot decide your own request.", 403);

    const next = decision === "approve" ? "approved" : "declined";
    // The job moves only if it is still waiting: a cancel that arrived first wins.
    const job = decision === "approve"
      ? await c.query("update jobs set status = 'queued', checkpoint = checkpoint || '{\"approved\": true}'::jsonb, run_after = now(), updated_at = now() where id = $1 and status = 'waiting_approval'", [a.job_id])
      : await c.query("update jobs set status = 'cancelled', error = $2, completed_at = now(), updated_at = now() where id = $1 and status = 'waiting_approval'", [a.job_id, `Declined: ${note}`]);
    if (!job.rowCount) {
      await c.query("update approvals set status = 'declined', decided_by = $2, decided_at = now(), reason = 'The request was cancelled first.' where id = $1", [id, actor.id]);
      throw new ApprovalError("That request was cancelled before it was decided.", 409);
    }
    await c.query("update approvals set status = $2, decided_by = $3, decided_at = now(), reason = $4 where id = $1", [id, next, actor.id, note]);
    if (a.requested_by) {
      await c.query(
        "insert into notifications (tenant_id, user_id, kind, title, body, href) values ($1, $2, 'approval', $3, $4, '/')",
        [actor.tenantId, a.requested_by, decision === "approve" ? "Your request was approved" : "Your request was declined", `${a.summary}. ${note}`.slice(0, 500)],
      );
    }
    await auditEvent(c, { tenantId: actor.tenantId, userId: actor.id, action: `approval.${next}`, entityType: "approval", entityId: id, metadata: { tool: a.tool } });
    return { status: next };
  });
}
