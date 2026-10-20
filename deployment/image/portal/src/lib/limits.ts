import { withTenant } from "./digi-db";

/**
 * Usage limits (M6.3), checked before an AI turn is accepted. Three layers, all with plain messages:
 *  - per person per minute (a burst guard, in memory),
 *  - per person per day (turns, from the run records),
 *  - per organisation per day (tokens, a spend cap an admin sets in the tenant configuration: ai_daily_token_cap, 0 or absent = no cap).
 * The admission queue (admission.ts) separately protects the runtime from too many turns at once.
 */
const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
const PER_MINUTE = () => num(process.env.CHAT_PER_MINUTE, 20);
const PER_DAY = () => num(process.env.AI_DAILY_TURNS_PER_USER, 300);

const recent = new Map<string, number[]>();

export type LimitResult = { ok: true } | { ok: false; message: string; retryAfter: number };

export async function checkChatLimits(tenantId: string, userId: string): Promise<LimitResult> {
  const now = Date.now();
  const key = `${tenantId}:${userId}`;
  const stamps = (recent.get(key) ?? []).filter((t) => now - t < 60_000);
  if (stamps.length >= PER_MINUTE()) {
    const retryAfter = Math.max(1, Math.ceil((stamps[0]! + 60_000 - now) / 1000));
    return { ok: false, message: "You are sending messages very quickly. Please wait a moment.", retryAfter };
  }
  if (recent.size > 5000) recent.clear();

  const used = await withTenant(tenantId, async (c) => {
    const day = "date_trunc('day', now())";
    const mine = (await c.query(`select count(*)::int as n from ai_runs where user_id = $1 and started_at >= ${day}`, [userId])).rows[0].n as number;
    const cfg = (await c.query("select configuration from tenants where id = $1", [tenantId])).rows[0]?.configuration as Record<string, unknown> | undefined;
    const cap = Number(cfg?.ai_daily_token_cap) || 0;
    const tokens = cap ? ((await c.query(`select coalesce(sum(coalesce(tokens_in,0) + coalesce(tokens_out,0)),0)::bigint as n from ai_runs where started_at >= ${day}`)).rows[0].n as string) : "0";
    return { mine, cap, tokens: Number(tokens) };
  });
  if (used.mine >= PER_DAY()) return { ok: false, message: `You have reached today's limit of ${PER_DAY()} questions. It resets tomorrow.`, retryAfter: 3600 };
  if (used.cap && used.tokens >= used.cap) return { ok: false, message: "Your organisation's AI allowance for today has been used. It resets tomorrow, or ask your administrator.", retryAfter: 3600 };

  stamps.push(now);
  recent.set(key, stamps);
  return { ok: true };
}
