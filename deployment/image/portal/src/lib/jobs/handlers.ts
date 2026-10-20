import { BookingError } from "../booking-service";
import { sendBookingEmails } from "../booking-emails";
import { MailError } from "../mail";
import { withTenant } from "../digi-db";
import { ApprovalNeeded, PermanentJobError, registerJobType, type JobActor } from "./engine";
import { sweepTenant } from "../retention";
import { getWorker, workerPolicyOf } from "../stack/workers";
import { decide } from "../tools/rules";
import { ToolError, type Args } from "../tools/registry";

/**
 * Job types. "email.booking" sends room booking emails. "tool.call" is what a tool becomes when Authority says ASK: the job is parked until another person approves, then it runs the
 * tool as the original actor with the approval counted. "test.steps" exists only to prove crash recovery (JOB_TEST_TYPES=1, never in production).
 */
const asActor = (a: JobActor) => ({ id: a.id, tenantId: a.tenantId, permissions: a.permissions, name: a.name, email: a.kind === "user" ? a.email : "" });

async function tell(a: JobActor, title: string, body: string) {
  if (a.kind !== "user") return;
  await withTenant(a.tenantId, (c) => c.query("insert into notifications (tenant_id, user_id, kind, title, body, href) values ($1, $2, 'approval', $3, $4, '/')", [a.tenantId, a.id, title, body.slice(0, 500)]))
    .catch(() => undefined);
}

registerJobType("tool.call", async ({ job, actor }) => {
  const p = job.payload as { tool?: string; args?: Args; worker?: string };
  if (!p.tool) throw new PermanentJobError("The job has no tool.");
  const args = p.args ?? {};
  const approved = job.checkpoint.approved === true;
  const actorLike = asActor(actor);
  // the Worker that asked is still bound by its own policy when the job runs
  const lab = p.worker?.startsWith("lab:") ?? false;
  const w = p.worker ? await getWorker(lab ? p.worker.slice(4) : p.worker, lab) : null;
  const d = await decide(actorLike, p.tool, w ? workerPolicyOf(w) : undefined, { approved });
  if (!d) throw new PermanentJobError("That tool no longer exists.");
  const { tool, decision } = d;
  if (decision.decision === "DENY") {
    await tell(actor, "Your request was not carried out", `You are no longer allowed to do this: ${decision.reason}.`);
    throw new PermanentJobError(`Not allowed: ${decision.reason}.`);
  }
  try {
    if (decision.decision === "ASK") {
      // The summary is what the approver reads. A write tool describes exactly what it would do; nothing is changed yet.
      const summary = tool.prepare ? (await tool.prepare(actorLike, args)).summary : tool.description;
      throw new ApprovalNeeded(tool.id, summary);
    }
    let result: unknown;
    if (tool.risk === "read") result = await tool.run!(actorLike, args);
    else result = await tool.commit!(actorLike, (await tool.prepare!(actorLike, args)).args);
    await tell(actor, "Your request was approved and carried out", tool.description);
    return result;
  } catch (e) {
    if (e instanceof ApprovalNeeded) throw e;
    if (e instanceof BookingError || e instanceof ToolError) {
      await tell(actor, "Your approved request could not be carried out", e.message);
      throw new PermanentJobError(e.message);
    }
    throw e;
  }
});

registerJobType("retention.sweep", async ({ actor }) => sweepTenant(actor.tenantId));

// Room booking emails, queued with the booking change (booking-emails.ts). A wrong secret or a missing setting fails at once; a network
// problem or a Microsoft outage is retried with growing waits.
registerJobType("email.booking", async ({ job, actor, save }) => {
  try {
    return await sendBookingEmails({ tenantId: actor.tenantId, payload: job.payload, checkpoint: job.checkpoint, save });
  } catch (e) {
    if (e instanceof MailError && e.permanent) throw new PermanentJobError(e.message);
    throw e;
  }
});

if (process.env.JOB_TEST_TYPES === "1") {
  registerJobType("test.steps", async ({ job, save, cancelled }) => {
    const steps = Number(job.payload.steps) || 5, ms = Number(job.payload.stepMs) || 1000;
    let step = Number(job.checkpoint.step) || 0;
    const seenBy = Array.isArray(job.checkpoint.workers) ? (job.checkpoint.workers as string[]) : [];
    for (; step < steps; step++) {
      if (await cancelled()) return { stoppedAt: step };
      await new Promise((r) => setTimeout(r, ms));
      // the checkpoint says how far we got and which attempt did each step
      await save({ step: step + 1, workers: [...seenBy, String(job.attempts)] });
      seenBy.push(String(job.attempts));
    }
    return { steps: step, attempts: job.attempts };
  });
}
