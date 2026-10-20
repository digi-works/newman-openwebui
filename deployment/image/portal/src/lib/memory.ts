import { auditEvent } from "./audit";
import { withTenant } from "./digi-db";
import { capabilityEnabled, clearRulesCache } from "./tools/rules";

/**
 * Explicit memory (M6.1). Digi remembers only what a person asked it to, as short notes they can see and delete. Notes are scoped to the
 * tenant and the person (row-level security and every query), are sent to the model only as that person's own background facts, and are never
 * extracted automatically. An organisation can switch memory off, which stops adding and stops using notes (they stay stored until deleted).
 */
export type Memory = { id: string; content: string; createdAt: string };
export const MAX_NOTES = 50;
export const CONTEXT_NOTES = 20;
export class MemoryError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export const memoryEnabled = (tenantId: string) => capabilityEnabled(tenantId, "memory.remember");

export async function listMemories(tenantId: string, userId: string): Promise<Memory[]> {
  return withTenant(tenantId, async (c) => {
    const { rows } = await c.query("select id, content, created_at from user_memories where user_id = $1 order by created_at", [userId]);
    return rows.map((r) => ({ id: r.id, content: r.content, createdAt: new Date(r.created_at).toISOString() }));
  });
}

/** The notes sent with a turn: none when memory is off. */
export async function memoriesForContext(tenantId: string, userId: string): Promise<string[]> {
  if (!(await memoryEnabled(tenantId))) return [];
  return (await listMemories(tenantId, userId)).slice(-CONTEXT_NOTES).map((m) => m.content);
}

export async function addMemory(tenantId: string, userId: string, text: string): Promise<Memory> {
  const content = text.trim().replace(/\s+/g, " ").slice(0, 500);
  if (!content) throw new MemoryError("Say what to remember.");
  if (!(await memoryEnabled(tenantId))) throw new MemoryError("Memory is switched off for your organisation.", 409);
  return withTenant(tenantId, async (c) => {
    const n = (await c.query("select count(*)::int as n from user_memories where user_id = $1", [userId])).rows[0].n as number;
    if (n >= MAX_NOTES) throw new MemoryError(`Digi can keep ${MAX_NOTES} notes. Delete one to add another.`, 409);
    const dup = (await c.query("select id, content, created_at from user_memories where user_id = $1 and lower(content) = lower($2)", [userId, content])).rows[0];
    const r = dup ?? (await c.query("insert into user_memories (tenant_id, user_id, content) values ($1, $2, $3) returning id, content, created_at", [tenantId, userId, content])).rows[0];
    if (!dup) await auditEvent(c, { tenantId, userId, action: "memory.add", entityType: "memory", entityId: r.id });
    return { id: r.id, content: r.content, createdAt: new Date(r.created_at).toISOString() };
  });
}

export async function deleteMemory(tenantId: string, userId: string, id: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  return withTenant(tenantId, async (c) => {
    const r = await c.query("delete from user_memories where id = $1 and user_id = $2", [id, userId]);
    if (r.rowCount) await auditEvent(c, { tenantId, userId, action: "memory.delete", entityType: "memory", entityId: id });
    return (r.rowCount ?? 0) > 0;
  });
}

/** An administrator switches memory on or off for the organisation. */
export async function setMemoryEnabled(admin: { id: string; tenantId: string }, enabled: boolean) {
  await withTenant(admin.tenantId, async (c) => {
    await c.query(
      `insert into tenant_capabilities (tenant_id, capability_id, enabled, updated_by) values ($1, 'memory.remember', $2, $3)
       on conflict (tenant_id, capability_id) do update set enabled = $2, updated_by = $3, updated_at = now()`,
      [admin.tenantId, enabled, admin.id],
    );
    await auditEvent(c, { tenantId: admin.tenantId, userId: admin.id, action: enabled ? "memory.enable" : "memory.disable", entityType: "capability", entityId: "memory.remember" });
  });
  clearRulesCache(admin.tenantId);
}
