import { createHash, randomBytes } from "node:crypto";
import { systemQuery, withTenant } from "./digi-db";

/**
 * Execution context: for every AI turn Digi creates a random, short-lived handle and uses it as the Open WebUI chat id.
 * When Open WebUI later calls a Digi tool, the tool sends that id back and Digi recovers the real tenant and user.
 * The id must start with "local:" so Open WebUI does not save the chat. Only a hash of the id is stored.
 * Proven in spike S0 (spikes/s0/RESULT.md).
 */
const PREFIX = "local:exec-";
const hash = (id: string) => createHash("sha256").update(id).digest("hex");

export async function createExecutionContext(
  tenantId: string, userId: string, opts: { conversationId?: string; runId?: string; workerId?: string; ttlSeconds?: number } = {},
): Promise<string> {
  const ttlSeconds = opts.ttlSeconds ?? 600;
  const id = PREFIX + randomBytes(24).toString("hex");
  await withTenant(tenantId, async (c) => {
    await c.query("delete from execution_contexts where expires_at < now() - interval '1 hour'");
    await c.query(
      "insert into execution_contexts (id_hash, tenant_id, user_id, conversation_id, run_id, worker_id, expires_at) values ($1, $2, $3, $4, $5, $6, now() + make_interval(secs => $7))",
      [hash(id), tenantId, userId, opts.conversationId ?? null, opts.runId ?? null, opts.workerId ?? null, ttlSeconds],
    );
  });
  return id;
}

export type ExecutionContext = { tenantId: string; userId: string; conversationId: string | null; runId: string | null; workerId: string | null };

export async function resolveExecutionContext(chatId: unknown): Promise<ExecutionContext | null> {
  if (typeof chatId !== "string" || !chatId.startsWith(PREFIX) || chatId.length > 200) return null;
  const { rows } = await systemQuery("select tenant_id, user_id, conversation_id, run_id, worker_id from resolve_execution_context($1)", [hash(chatId)]);
  const r = rows[0];
  return r ? { tenantId: r.tenant_id, userId: r.user_id, conversationId: r.conversation_id, runId: r.run_id, workerId: r.worker_id } : null;
}
