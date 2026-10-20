import { auditEvent } from "../audit";
import { systemQuery, withTenant } from "../digi-db";
import { getIdentity, type Identity } from "./identity";
import { listReleases, type Rel } from "./installer";

/** What a customer Admin sees about AI updates and capabilities. Capabilities, never Workers' instructions, prompts, models or runtime details. */
export type CapabilityRow = { id: string; name: string; description: string; version: number; release: string; apps: Record<string, boolean> };
export type UpdatesView = {
  identity: Omit<Identity, "publicKey">; releases: (Omit<Rel, "manifest"> & { capabilities: { name: string; description: string }[]; notes: string })[];
  capabilities: CapabilityRow[]; apps: { id: string; name: string }[]; events: { kind: string; releaseId: string | null; at: string }[];
};

export async function updatesView(tenantId: string): Promise<UpdatesView> {
  const { publicKey: _pk, ...identity } = await getIdentity();
  void _pk;
  const releases = (await listReleases()).map(({ manifest, ...r }) => ({
    ...r, notes: String(manifest.notes ?? ""),
    capabilities: ((manifest.workers as { name: string; description: string }[]) ?? []).map((w) => ({ name: w.name, description: w.description })),
  }));
  const apps = (await systemQuery("select id, name from apps order by id")).rows as { id: string; name: string }[];
  const workers = (await systemQuery("select worker_id, name, description, version, release_id from installed_workers where active and release_id <> 'lab' order by name")).rows;
  const switches = await withTenant(tenantId, async (c) => (await c.query("select app_id, capability_id, enabled from tenant_app_capabilities")).rows);
  const capabilities = workers.map((w) => ({
    id: w.worker_id as string, name: w.name as string, description: w.description as string, version: w.version as number, release: w.release_id as string,
    apps: Object.fromEntries(apps.map((a) => [a.id, switches.find((s) => s.app_id === a.id && s.capability_id === `worker:${w.worker_id}`)?.enabled ?? true])),
  }));
  const events = (await systemQuery("select kind, release_id, at from stack_events order by id desc limit 15")).rows.map((e) => ({ kind: e.kind as string, releaseId: e.release_id as string | null, at: new Date(e.at as string).toISOString() }));
  return { identity, releases, capabilities, apps, events };
}

/** An Admin switches a capability on or off for one App. (Which roles may use it is set on Settings > Permissions.) */
export async function setAppCapability(admin: { id: string; tenantId: string }, appId: string, workerId: string, enabled: boolean) {
  const ok = (await systemQuery("select 1 from apps a, installed_workers w where a.id = $1 and w.worker_id = $2 and w.active and w.release_id <> 'lab'", [appId, workerId])).rows.length > 0;
  if (!ok) return false;
  await withTenant(admin.tenantId, async (c) => {
    await c.query(
      `insert into tenant_app_capabilities (tenant_id, app_id, capability_id, enabled, updated_by) values ($1, $2, $3, $4, $5)
       on conflict (tenant_id, app_id, capability_id) do update set enabled = $4, updated_by = $5, updated_at = now()`,
      [admin.tenantId, appId, `worker:${workerId}`, enabled, admin.id],
    );
    await auditEvent(c, { tenantId: admin.tenantId, userId: admin.id, action: "capability.app", entityType: "capability", entityId: workerId, metadata: { app: appId, enabled } });
  });
  return true;
}
