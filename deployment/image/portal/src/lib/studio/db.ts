import { Pool, type PoolClient, type QueryResultRow } from "pg";

/**
 * The platform realm's own Postgres database (not a customer's). Only the platform instance has STUDIO_DATABASE_URL, and it connects as
 * studio_app, which cannot update or delete the audit trail and cannot delete published specs or releases (see db/studio-migrations).
 */
export const studioEnabled = () => !!process.env.STUDIO_DATABASE_URL;

const g = globalThis as { __studioPool?: Pool };
function pool(): Pool {
  if (!g.__studioPool) {
    g.__studioPool = new Pool({ connectionString: process.env.STUDIO_DATABASE_URL, max: 8, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
    g.__studioPool.on("error", (e) => console.error("studio db pool error", e.message));
  }
  return g.__studioPool;
}

export async function sq<T extends QueryResultRow = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await pool().query<T>(text, params)).rows;
}

export async function stx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool().connect();
  try {
    await c.query("begin");
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

/** Appends to the platform audit trail. Never put secrets or full specs in metadata. */
export async function studioAudit(
  e: { operatorId?: string | null; actor?: string; action: string; entityType?: string; entityId?: string; result?: "success" | "denied" | "failed"; metadata?: Record<string, unknown> },
  c?: PoolClient,
) {
  const args = [e.operatorId ?? null, e.actor ?? "operator", e.action, e.entityType ?? null, e.entityId ?? null, e.result ?? "success", JSON.stringify(e.metadata ?? {})];
  const sql = "insert into studio_audit_events (operator_id, actor, action, entity_type, entity_id, result, metadata) values ($1, $2, $3, $4, $5, $6, $7)";
  if (c) await c.query(sql, args);
  else await pool().query(sql, args);
}
