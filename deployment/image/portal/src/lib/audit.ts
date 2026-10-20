import type { PoolClient } from "pg";

/** Appends an audit row inside the caller's tenant transaction. Never put secrets or raw tool payloads in metadata. */
export async function auditEvent(
  c: PoolClient,
  e: { tenantId: string; userId?: string | null; action: string; entityType?: string; entityId?: string; result?: "success" | "denied" | "failed"; source?: string; metadata?: Record<string, unknown> },
) {
  await c.query(
    `insert into audit_events (tenant_id, user_id, action, entity_type, entity_id, source, result, metadata)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [e.tenantId, e.userId ?? null, e.action, e.entityType ?? null, e.entityId ?? null, e.source ?? "portal", e.result ?? "success", JSON.stringify(e.metadata ?? {})],
  );
}
