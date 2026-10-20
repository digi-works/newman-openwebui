import { createHash } from "node:crypto";
import { BookingError, type Actor } from "./booking-service";
import { auditEvent } from "./audit";
import { withTenant } from "./digi-db";
import { decide } from "./tools/rules";
import { ToolError, type Args } from "./tools/registry";

/**
 * Pending actions (M5.4). A write tool never commits: it prepares an action, which is shown in the chat as a card. Only the person's click
 * (an authenticated Digi request) commits it, so words in a chat such as "yes, confirmed" can never change data. The idempotency key makes
 * the same prepared request one action, and the confirm step claims the action atomically, so a double click or a retry commits once.
 */
export type PendingAction = {
  id: string; tool: string; summary: string; status: "pending" | "confirmed" | "cancelled" | "expired" | "failed";
  result?: Record<string, unknown> | null; error?: string | null; messageId?: string | null; expiresAt: string;
};

const TTL_MINUTES = 30;
const stable = (v: unknown): string => (v && typeof v === "object" ? JSON.stringify(Object.keys(v as object).sort().map((k) => [k, (v as Args)[k]])) : JSON.stringify(v));
const row = (r: Record<string, unknown>): PendingAction => ({
  id: r.id as string, tool: r.tool as string, summary: r.summary as string, status: r.status as PendingAction["status"],
  result: (r.result as Record<string, unknown> | null) ?? null, error: (r.error as string | null) ?? null, messageId: (r.message_id as string | null) ?? null,
  expiresAt: new Date(r.expires_at as string).toISOString(),
});

export async function createPending(
  actor: Actor, run: { runId: string | null; conversationId: string | null }, tool: string, prepared: { summary: string; args: Args },
): Promise<PendingAction> {
  const key = createHash("sha256").update([run.runId ?? "", tool, stable(prepared.args)].join("|")).digest("hex");
  return withTenant(actor.tenantId, async (c) => {
    const message = run.runId ? (await c.query("select message_id from ai_runs where id = $1", [run.runId])).rows[0]?.message_id ?? null : null;
    const { rows } = await c.query(
      `insert into pending_actions (tenant_id, user_id, conversation_id, message_id, run_id, tool, args, summary, idempotency_key, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now() + make_interval(mins => $10))
       on conflict (tenant_id, user_id, idempotency_key) do update set summary = pending_actions.summary
       returning *`,
      [actor.tenantId, actor.id, run.conversationId, message, run.runId, tool, JSON.stringify(prepared.args), prepared.summary, key, TTL_MINUTES],
    );
    return row(rows[0]);
  });
}

export async function actionsForConversation(tenantId: string, userId: string, conversationId: string): Promise<PendingAction[]> {
  return withTenant(tenantId, async (c) => {
    await c.query("update pending_actions set status = 'expired', decided_at = now() where status = 'pending' and expires_at < now()");
    const { rows } = await c.query("select * from pending_actions where conversation_id = $1 and user_id = $2 order by created_at", [conversationId, userId]);
    return rows.map(row);
  });
}

export async function getAction(actor: Actor, id: string): Promise<PendingAction | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return withTenant(actor.tenantId, async (c) => {
    const r = (await c.query("select * from pending_actions where id = $1 and user_id = $2", [id, actor.id])).rows[0];
    return r ? row(r) : null;
  });
}

export type ConfirmOutcome = { action: PendingAction | null; error?: string; status: number };

/** The person confirms. Permissions and the organisation's policy are checked again now, not trusted from when the action was prepared. */
export async function confirmAction(actor: Actor, id: string): Promise<ConfirmOutcome> {
  const current = await getAction(actor, id);
  if (!current) return { action: null, error: "That action no longer exists.", status: 404 };
  if (current.status !== "pending") return { action: current, status: 200 };

  const claimed = await withTenant(actor.tenantId, async (c) => {
    const r = (await c.query(
      `update pending_actions set status = 'confirmed', decided_at = now() where id = $1 and user_id = $2 and status = 'pending' and expires_at > now() returning *`,
      [id, actor.id],
    )).rows[0];
    return r ?? null;
  });
  if (!claimed) {
    // someone else won the claim (a double click) or it expired: report what it is now
    await withTenant(actor.tenantId, (c) => c.query("update pending_actions set status = 'expired', decided_at = now() where id = $1 and status = 'pending' and expires_at < now()", [id]));
    const now = await getAction(actor, id);
    const expired = now?.status === "expired";
    return { action: now, status: expired ? 410 : 200, error: expired ? "This request expired. Ask Digi again." : undefined };
  }

  let result: unknown = null, error: string | null = null, status = 200;
  try {
    const d = await decide(actor, claimed.tool);
    if (!d?.tool.commit || d.decision.decision !== "ALLOW") throw new ToolError("You are no longer allowed to do this.", 403);
    result = await d.tool.commit(actor, claimed.args as Args);
  } catch (e) {
    const known = e instanceof BookingError || e instanceof ToolError;
    error = known ? (e as Error).message : "Something went wrong. Please try again.";
    status = known ? (e as BookingError).status : 502;
    if (!known) console.error("confirm action failed", e);
  }
  const final = await withTenant(actor.tenantId, async (c) => {
    const r = (await c.query(
      "update pending_actions set status = $2, result = $3, error = $4 where id = $1 returning *",
      [id, error ? "failed" : "confirmed", error ? null : JSON.stringify(result), error],
    )).rows[0];
    await auditEvent(c, { tenantId: actor.tenantId, userId: actor.id, action: "action.confirm", entityType: "pending_action", entityId: id, result: error ? "failed" : "success", metadata: { tool: claimed.tool } });
    return row(r);
  });
  return { action: final, error: error ?? undefined, status: error ? status : 200 };
}

export async function cancelAction(actor: Actor, id: string): Promise<PendingAction | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const r = await withTenant(actor.tenantId, async (c) => {
    await c.query("update pending_actions set status = 'cancelled', decided_at = now() where id = $1 and user_id = $2 and status = 'pending'", [id, actor.id]);
    return (await c.query("select * from pending_actions where id = $1 and user_id = $2", [id, actor.id])).rows[0];
  });
  return r ? row(r) : null;
}
