import { withTenant } from "./digi-db";

/**
 * One record per AI response (M5.5): who, which model, which tools were offered, how long, how it ended. No raw prompts, answers or tool
 * payloads are kept here. Token counts are filled when the runtime reports them.
 */
export type RunStart = { tenantId: string; userId: string; conversationId: string; messageId: string; runtime: string; model: string; toolsAvailable: string[]; inputChars: number; workerId?: string; app?: string };

export async function startRun(r: RunStart): Promise<string> {
  return withTenant(r.tenantId, async (c) => {
    const { rows } = await c.query(
      `insert into ai_runs (tenant_id, user_id, conversation_id, message_id, runtime, model, tools_available, input_chars, worker_id, app)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
      [r.tenantId, r.userId, r.conversationId, r.messageId, r.runtime, r.model, r.toolsAvailable, r.inputChars, r.workerId ?? null, r.app ?? null],
    );
    return rows[0].id as string;
  });
}

export async function finishRun(
  tenantId: string, runId: string,
  f: { status: "done" | "stopped" | "error"; error?: string; queueMs?: number; durationMs: number; outputChars: number; tokensIn?: number; tokensOut?: number },
) {
  await withTenant(tenantId, async (c) => {
    await c.query(
      `update ai_runs set status = $2, error = $3, queue_ms = $4, duration_ms = $5, output_chars = $6, tokens_in = $7, tokens_out = $8, finished_at = now() where id = $1`,
      [runId, f.status, f.error?.slice(0, 300) ?? null, f.queueMs ?? null, f.durationMs, f.outputChars, f.tokensIn ?? null, f.tokensOut ?? null],
    );
  });
}
