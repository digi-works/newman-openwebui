import { hostname } from "node:os";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { auditEvent } from "../audit";
import { withTenant, systemQuery } from "../digi-db";
import { accessFor } from "../session";

/**
 * The durable job engine (M5.8), built on Postgres so it needs nothing else to run.
 *
 *   QUEUED → RUNNING → COMPLETED | FAILED | CANCELLED
 *               ↘ WAITING_APPROVAL → (another person approves) → QUEUED → resumes from its checkpoint
 *
 * - Survives a crash: a running job holds a lease that its worker keeps renewing. If the worker dies the lease runs out, and any worker
 *   (this process after a restart, or another) picks the job up again and continues from its last checkpoint.
 * - Independent of any browser: nothing here depends on a page staying open.
 * - Retries with a ceiling and growing waits; permanent errors fail at once; idempotency keys stop duplicates; tenants get a concurrency cap.
 * - Approval: when Authority says ASK, the job is parked with an approval record. Deciding it moves that one job back to QUEUED, once.
 * Work runs as an actor, a signed-in person or a named service identity, with permissions read live.
 */
export type JobActor =
  | { kind: "user"; id: string; tenantId: string; name: string; email: string; permissions: string[] }
  | { kind: "service"; id: string; tenantId: string; name: string; permissions: string[] };

export type JobRow = {
  id: string; tenantId: string; type: string; status: "queued" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled";
  payload: Record<string, unknown>; checkpoint: Record<string, unknown>; result: unknown; error: string | null;
  actorUserId: string | null; actorServiceId: string | null; attempts: number; maxAttempts: number; createdAt: string; completedAt: string | null;
};

/** A failure retrying cannot fix (a rule, a missing permission). The job fails at once. */
export class PermanentJobError extends Error {}
/** Thrown by a handler to park the job until another person approves it. */
export class ApprovalNeeded extends Error {
  constructor(readonly tool: string, readonly summary: string) { super("approval needed"); }
}

export type JobContext = {
  job: JobRow;
  actor: JobActor;
  save: (checkpoint: Record<string, unknown>) => Promise<void>;
  /** True once someone cancelled the job; long handlers should check between steps and return. */
  cancelled: () => Promise<boolean>;
};
export type JobHandler = (ctx: JobContext) => Promise<unknown>;

const handlers = new Map<string, JobHandler>();
export const registerJobType = (type: string, handler: JobHandler) => { handlers.set(type, handler); };

const LEASE_SECONDS = () => Number(process.env.JOB_LEASE_SECONDS) || 60;
const TENANT_LIMIT = () => Number(process.env.JOB_TENANT_CONCURRENCY) || 2;
export const workerId = `${hostname()}:${process.pid}:${Math.random().toString(36).slice(2, 6)}`;

const toRow = (r: Record<string, unknown>): JobRow => ({
  id: r.id as string, tenantId: r.tenant_id as string, type: r.type as string, status: r.status as JobRow["status"],
  payload: (r.payload as Record<string, unknown>) ?? {}, checkpoint: (r.checkpoint as Record<string, unknown>) ?? {}, result: r.result ?? null,
  error: (r.error as string) ?? null, actorUserId: (r.actor_user_id as string) ?? null, actorServiceId: (r.actor_service_id as string) ?? null,
  attempts: Number(r.attempts), maxAttempts: Number(r.max_attempts), createdAt: new Date(r.created_at as string).toISOString(),
  completedAt: r.completed_at ? new Date(r.completed_at as string).toISOString() : null,
});

export const idempotencyKey = (...parts: unknown[]) => createHash("sha256").update(parts.map((p) => JSON.stringify(p)).join("|")).digest("hex");

export async function enqueue(
  tenantId: string, type: string, payload: Record<string, unknown>,
  o: { actor: { kind: "user" | "service"; id: string }; idempotencyKey?: string; runAfter?: Date; maxAttempts?: number; status?: "queued" | "waiting_approval"; checkpoint?: Record<string, unknown> },
): Promise<JobRow> {
  return withTenant(tenantId, async (c) => {
    const { rows } = await c.query(
      `insert into jobs (tenant_id, type, payload, checkpoint, status, actor_user_id, actor_service_id, idempotency_key, run_after, max_attempts)
       values ($1, $2, $3, $4, $5, $6, $7, $8, coalesce($9, now()), $10)
       on conflict (tenant_id, idempotency_key) where idempotency_key is not null do update set updated_at = jobs.updated_at
       returning *`,
      [tenantId, type, JSON.stringify(payload), JSON.stringify(o.checkpoint ?? {}), o.status ?? "queued", o.actor.kind === "user" ? o.actor.id : null,
        o.actor.kind === "service" ? o.actor.id : null, o.idempotencyKey ?? null, o.runAfter ?? null, o.maxAttempts ?? 3],
    );
    return toRow(rows[0]);
  });
}

export async function getJob(tenantId: string, id: string): Promise<JobRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return withTenant(tenantId, async (c) => {
    const r = (await c.query("select * from jobs where id = $1", [id])).rows[0];
    return r ? toRow(r) : null;
  });
}

/** Cancels a job that has not finished. A running handler notices at its next check; its result is then discarded. */
export async function cancelJob(tenantId: string, id: string, by: string, reason = "Cancelled."): Promise<JobRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return withTenant(tenantId, async (c) => {
    const r = (await c.query(
      `update jobs set status = 'cancelled', error = $2, locked_by = null, locked_until = null, completed_at = now(), updated_at = now()
        where id = $1 and status in ('queued', 'running', 'waiting_approval') returning *`, [id, reason],
    )).rows[0];
    if (r) {
      await c.query("update approvals set status = 'declined', decided_at = now(), reason = coalesce(reason, $2) where job_id = $1 and status = 'pending'", [id, reason]);
      await auditEvent(c, { tenantId, userId: by, action: "job.cancel", entityType: "job", entityId: id });
    }
    const row = r ?? (await c.query("select * from jobs where id = $1", [id])).rows[0];
    return row ? toRow(row) : null;
  });
}

async function loadActor(c: PoolClient, job: JobRow): Promise<JobActor | null> {
  if (job.actorUserId) {
    const u = (await c.query("select name, email from users where id = $1 and status = 'active'", [job.actorUserId])).rows[0];
    if (!u) return null;
    // permissions are read live: a role change since the job was queued applies now
    const access = await accessFor(job.tenantId, job.actorUserId);
    return { kind: "user", id: job.actorUserId, tenantId: job.tenantId, name: u.name, email: u.email, permissions: access.permissions };
  }
  const s = (await c.query("select name, permissions from service_identities where id = $1 and enabled", [job.actorServiceId])).rows[0];
  return s ? { kind: "service", id: job.actorServiceId!, tenantId: job.tenantId, name: s.name, permissions: s.permissions } : null;
}

const backoffSeconds = (attempt: number) => Math.min(300, 5 * 2 ** (attempt - 1));

/** Claims and runs one job if any is ready. Returns false when there was nothing to do. */
export async function runOne(): Promise<boolean> {
  const lease = LEASE_SECONDS();
  const claim = (await systemQuery("select id, tenant_id from claim_job($1, $2, $3)", [workerId, lease, TENANT_LIMIT()])).rows[0];
  if (!claim) return false;
  const tenantId = claim.tenant_id as string, id = claim.id as string;

  // keep the lease alive while the handler works; if this process dies, the lease runs out and another worker takes over
  const beat = setInterval(() => {
    void withTenant(tenantId, (c) => c.query("update jobs set locked_until = now() + make_interval(secs => $3) where id = $1 and locked_by = $2 and status = 'running'", [id, workerId, lease])).catch(() => undefined);
  }, Math.max(1000, (lease * 1000) / 3));

  try {
    const job = await getJob(tenantId, id);
    if (!job) return true;
    const handler = handlers.get(job.type);
    const actor = await withTenant(tenantId, (c) => loadActor(c, job));
    if (!handler) { await finish(tenantId, id, "failed", { error: `No handler for job type ${job.type}.` }); return true; }
    if (!actor) { await finish(tenantId, id, "failed", { error: "The person or service this job runs as is no longer active." }); return true; }

    const ctx: JobContext = {
      job, actor,
      save: (checkpoint) => withTenant(tenantId, async (c) => { await c.query("update jobs set checkpoint = $2, updated_at = now() where id = $1 and status = 'running'", [id, JSON.stringify(checkpoint)]); }),
      cancelled: () => withTenant(tenantId, async (c) => (await c.query("select status = 'cancelled' as x from jobs where id = $1", [id])).rows[0]?.x === true),
    };
    try {
      const result = await handler(ctx);
      await finish(tenantId, id, "completed", { result });
    } catch (e) {
      if (e instanceof ApprovalNeeded) {
        await park(tenantId, job, e);
      } else if (e instanceof PermanentJobError) {
        await finish(tenantId, id, "failed", { error: e.message });
      } else {
        const msg = e instanceof Error ? e.message : "failed";
        const cur = await getJob(tenantId, id);
        if (cur && cur.attempts >= cur.maxAttempts) await finish(tenantId, id, "failed", { error: msg.slice(0, 300) });
        else await withTenant(tenantId, async (c) => {
          await c.query("update jobs set status = 'queued', error = $2, locked_by = null, locked_until = null, run_after = now() + make_interval(secs => $3), updated_at = now() where id = $1 and status = 'running'", [id, msg.slice(0, 300), backoffSeconds(cur?.attempts ?? 1)]);
        });
      }
    }
  } finally {
    clearInterval(beat);
  }
  return true;
}

/** Only a job that is still running is moved: a cancel that arrived meanwhile wins and the result is dropped. */
async function finish(tenantId: string, id: string, status: "completed" | "failed", o: { result?: unknown; error?: string }) {
  await withTenant(tenantId, async (c) => {
    await c.query(
      `update jobs set status = $2, result = $3, error = $4, locked_by = null, locked_until = null, completed_at = now(), updated_at = now() where id = $1 and status = 'running'`,
      [id, status, o.result === undefined ? null : JSON.stringify(o.result), o.error ?? null],
    );
  });
}

async function park(tenantId: string, job: JobRow, need: ApprovalNeeded) {
  await withTenant(tenantId, async (c) => {
    const r = await c.query("update jobs set status = 'waiting_approval', locked_by = null, locked_until = null, updated_at = now() where id = $1 and status = 'running'", [job.id]);
    if (!r.rowCount) return;
    await c.query("insert into approvals (tenant_id, job_id, requested_by, tool, summary) values ($1, $2, $3, $4, $5) on conflict do nothing", [tenantId, job.id, job.actorUserId, need.tool, need.summary]);
  });
}
