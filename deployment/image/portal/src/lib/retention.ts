import { auditEvent } from "./audit";
import { systemQuery, withTenant } from "./digi-db";
import { enqueue } from "./jobs/engine";

/**
 * Conversation retention (M6.2). Conversations are deleted a set number of days after their last activity: the tenant setting
 * configuration.conversation_retention_days, 30 by default. Their messages go with them, and so do prepared actions and old notifications.
 * Audit events are a separate record and are not touched. A conversation with an answer still being written is left alone. Every sweep
 * writes an audit row with the counts and no content.
 */
export const DEFAULT_RETENTION_DAYS = 30;

export async function retentionDays(tenantId: string): Promise<number> {
  const cfg = await withTenant(tenantId, async (c) => (await c.query("select configuration from tenants where id = $1", [tenantId])).rows[0]?.configuration ?? {});
  const n = Number((cfg as Record<string, unknown>).conversation_retention_days);
  return Number.isInteger(n) && n >= 1 && n <= 3650 ? n : DEFAULT_RETENTION_DAYS;
}

export type SweepResult = { days: number; conversations: number; messages: number; actions: number; notifications: number; jobs: number };

export async function sweepTenant(tenantId: string): Promise<SweepResult> {
  const days = await retentionDays(tenantId);
  return withTenant(tenantId, async (c) => {
    const cutoff = `now() - make_interval(days => ${days})`;
    const old = `select id from conversations where updated_at < ${cutoff} and not exists (select 1 from messages m where m.conversation_id = conversations.id and m.status = 'streaming' and m.updated_at > now() - interval '5 minutes')`;
    const messages = (await c.query(`select count(*)::int as n from messages where conversation_id in (${old})`)).rows[0].n as number;
    const actions = (await c.query(`delete from pending_actions where conversation_id in (${old}) or created_at < ${cutoff}`)).rowCount ?? 0;
    const conversations = (await c.query(`delete from conversations where id in (${old})`)).rowCount ?? 0;
    const notifications = (await c.query(`delete from notifications where created_at < ${cutoff}`)).rowCount ?? 0;
    const jobs = (await c.query(`delete from jobs where status in ('completed', 'failed', 'cancelled') and completed_at < ${cutoff}`)).rowCount ?? 0;
    await c.query("delete from execution_contexts where expires_at < now() - interval '1 hour'");
    const out = { days, conversations, messages, actions, notifications, jobs };
    await auditEvent(c, { tenantId, userId: null, action: "retention.sweep", entityType: "tenant", entityId: tenantId, source: "retention", metadata: out });
    return out;
  });
}

/** A service identity the sweep runs as, created once per tenant. It holds no permissions. */
async function retentionIdentity(tenantId: string): Promise<string> {
  return withTenant(tenantId, async (c) => {
    await c.query("insert into service_identities (tenant_id, name, permissions) values ($1, 'retention', '{}') on conflict (tenant_id, name) do nothing", [tenantId]);
    return (await c.query("select id from service_identities where name = 'retention'")).rows[0].id as string;
  });
}

/** Makes sure each active tenant has one sweep queued for today. Safe to call often: the day is part of the idempotency key. */
export async function scheduleRetention(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const { rows } = await systemQuery("select id from tenants where status = 'active'");
  for (const t of rows) {
    const id = await retentionIdentity(t.id);
    await enqueue(t.id, "retention.sweep", {}, { actor: { kind: "service", id }, idempotencyKey: `retention:${t.id}:${day}` });
  }
}
