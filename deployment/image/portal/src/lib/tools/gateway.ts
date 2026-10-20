import { BookingError } from "../booking-service";
import { auditEvent } from "../audit";
import { withTenant } from "../digi-db";
import { callerFromChatId } from "../internal-actor";
import { enqueue, idempotencyKey } from "../jobs/engine";
import { createPending } from "../pending-actions";
import { getWorker, workerPolicyOf } from "../stack/workers";
import { roomFormEmbed, roomResultsEmbed } from "./embeds";
import { decide } from "./rules";
import { ToolError, type Args } from "./registry";

/**
 * The Tool Gateway (M5.1). Open WebUI tools call this with the per-turn handle and a tool name. Digi recovers who is asking from the handle,
 * asks the Authority engine, runs the tool through its business function (never SQL), and records the call. Nothing in the arguments says
 * who the person is. Results are small, plain objects for the model to read.
 */
export type GatewayResult = { status: number; body: Record<string, unknown> };

async function record(tenantId: string, userId: string, runId: string | null, tool: string, decision: "allow" | "ask" | "deny", status: string, reason: string | undefined, ms: number) {
  await withTenant(tenantId, async (c) => {
    await c.query(
      "insert into tool_calls (tenant_id, run_id, user_id, tool, decision, status, reason, duration_ms) values ($1, $2, $3, $4, $5, $6, $7, $8)",
      [tenantId, runId, userId, tool, decision, status, reason?.slice(0, 200) ?? null, ms],
    );
    if (decision === "deny") await auditEvent(c, { tenantId, userId, action: "tool.denied", entityType: "tool", entityId: tool, result: "denied", source: "tool-gateway", metadata: { reason } });
  }).catch((e) => console.error("recording a tool call failed", e));
}

export async function callTool(chatId: unknown, toolId: string, args: Args, opts: { embeds?: boolean } = {}): Promise<GatewayResult> {
  const caller = await callerFromChatId(chatId);
  if (!caller) return { status: 401, body: { error: "I could not tell who is asking. Please sign in again and retry." } };
  const { actor, ctx } = caller;
  const started = Date.now();
  // When a Worker is handling the turn, its own policy narrows what this person may do (never widens it).
  const lab = ctx.workerId?.startsWith("lab:") ?? false;
  const worker = ctx.workerId ? await getWorker(lab ? ctx.workerId.slice(4) : ctx.workerId, lab) : null;
  const d = await decide(actor, toolId, worker ? workerPolicyOf(worker) : undefined);
  if (!d) return { status: 404, body: { error: "Unknown tool." } };
  const { tool, decision } = d;
  const ms = () => Date.now() - started;

  if (decision.decision === "DENY") {
    await record(actor.tenantId, actor.id, ctx.runId, tool.id, "deny", "denied", decision.reason, ms());
    return { status: 403, body: { error: `You cannot do this: ${decision.reason}.` } };
  }
  if (decision.decision === "ASK") {
    // Another person must decide first. The call becomes a durable job that waits for that approval, then runs as this person.
    const job = await enqueue(actor.tenantId, "tool.call", { tool: tool.id, args, worker: ctx.workerId ?? undefined }, {
      actor: { kind: "user", id: actor.id }, idempotencyKey: ctx.runId ? idempotencyKey(ctx.runId, tool.id, args) : undefined,
    });
    await record(actor.tenantId, actor.id, ctx.runId, tool.id, "ask", "awaiting_approval", decision.reason, ms());
    return {
      status: 200,
      body: { pending_approval: true, job_id: job.id, message: "This needs another person's approval first. It has been sent to them, and the person will be told in Digi when it is decided. Nothing has been done yet. Do not say it is done." },
    };
  }
  try {
    if (tool.risk === "read") {
      const data = (await tool.run!(actor, args)) as Record<string, unknown>;
      await record(actor.tenantId, actor.id, ctx.runId, tool.id, "allow", "ok", undefined, ms());
      // A runtime that cannot build its own forms (Strands) asks for them here; the Open WebUI tool modules build theirs.
      if (opts.embeds && tool.id === "rooms.form") data.embed = roomFormEmbed((data.buildings as string[]) ?? [], (data.needs as string[]) ?? []);
      if (opts.embeds && tool.id === "rooms.search") {
        const n = Array.isArray(args.needs) ? (args.needs as unknown[]).filter((x): x is string => typeof x === "string") : [];
        data.embed = roomResultsEmbed((data.rooms as never) ?? [], String(data.note ?? ""), { purpose: String(args.purpose ?? "Room request"), date: String(args.date ?? ""), start_time: String(args.start_time ?? ""), end_time: String(args.end_time ?? ""), people: Number(args.people) || 1, needs: n });
      }
      return { status: 200, body: data };
    }
    // write: prepare only. The person's click in the Digi UI commits it.
    const prepared = await tool.prepare!(actor, args);
    const action = await createPending(actor, { runId: ctx.runId, conversationId: ctx.conversationId }, tool.id, prepared);
    await record(actor.tenantId, actor.id, ctx.runId, tool.id, "allow", "awaiting_confirmation", undefined, ms());
    return {
      status: 200,
      body: {
        pending: true, action_id: action.id, summary: prepared.summary,
        message: "Prepared. A confirmation card is now shown to the person in Digi. Nothing has been done yet. Tell them to review it and press Confirm. Do not say it is submitted.",
      },
    };
  } catch (e) {
    const known = e instanceof BookingError || e instanceof ToolError;
    await record(actor.tenantId, actor.id, ctx.runId, tool.id, "allow", "error", known ? (e as Error).message : "failure", ms());
    if (!known) console.error(`tool ${tool.id} failed`, e);
    return { status: known ? (e as BookingError).status : 502, body: { error: known ? (e as Error).message : "Could not complete that just now." } };
  }
}
