import { Pool, type PoolClient } from "pg";

/**
 * Digi's own Postgres (not the Supabase pilot store in db.ts). The app connects as digi_app, which cannot bypass
 * row-level security, so every tenant-owned query must run inside withTenant().
 */
export const digiDbEnabled = () => !!process.env.DIGI_DATABASE_URL;

const g = globalThis as { __digiPool?: Pool };

function pool(): Pool {
  if (!g.__digiPool) {
    g.__digiPool = new Pool({ connectionString: process.env.DIGI_DATABASE_URL, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
    g.__digiPool.on("error", (e) => console.error("digi db pool error", e.message));
  }
  return g.__digiPool;
}

/** Runs fn in a transaction with the tenant set for row-level security. The setting is local to the transaction. */
export async function withTenant<T>(tenantId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/** For the few lookups that happen before a tenant is known (tenants, hostnames, execution-context resolve). */
export const systemQuery = (text: string, params: unknown[] = []) => pool().query(text, params);
