import { headers } from "next/headers";
import { systemQuery } from "./digi-db";

export type Tenant = { id: string; slug: string; name: string; configuration: Record<string, unknown> };

const cache = new Map<string, { at: number; tenant: Tenant | null }>();
const TTL_MS = 30_000;

/** The public hostname of this request, without a port. Cloudflare and the proxy pass it as the Host header. */
export async function requestHost(): Promise<string> {
  const h = await headers();
  const raw = (h.get("x-forwarded-host") || h.get("host") || "").split(",")[0]!.trim().toLowerCase();
  return raw.replace(/:\d+$/, "");
}

export async function tenantForHost(host: string): Promise<Tenant | null> {
  const hit = cache.get(host);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.tenant;
  const { rows } = await systemQuery(
    `select t.id, t.slug, t.name, t.configuration
       from tenant_hostnames h join tenants t on t.id = h.tenant_id
      where h.hostname = $1 and t.status = 'active'`,
    [host],
  );
  const tenant = rows[0] ? ({ id: rows[0].id, slug: rows[0].slug, name: rows[0].name, configuration: rows[0].configuration } as Tenant) : null;
  cache.set(host, { at: Date.now(), tenant });
  return tenant;
}

export async function getTenant(): Promise<Tenant | null> {
  return tenantForHost(await requestHost());
}
