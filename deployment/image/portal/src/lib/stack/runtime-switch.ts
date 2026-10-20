import { auditEvent } from "../audit";
import { systemQuery, withTenant } from "../digi-db";
import { forgetRuntimeChoice, runtimeById, currentRuntimeId, type RuntimeId } from "../runtime";
import type { Bundle } from "../release/verify";
import { compileInto } from "./installer";

/**
 * Which AI runtime this stack runs on (Settings > AI connection). Decided per stack by its Admin. Open WebUI is the default and stays so until Strands has passed
 * the same tests. Switching is safe by construction: the target must be healthy, must support every runtime feature the active release's Workers need, and must
 * answer a real test turn with this organisation's model access; only then are the Workers recompiled for it and the setting flipped, in that order. A failure at
 * any step leaves the current runtime untouched. Switching back is the same action. Digi's own data (people, permissions, conversations, bookings, memory,
 * approvals, audit) does not move, because it never lived in a runtime.
 */
export type RuntimeOption = { id: RuntimeId; name: string; ok: boolean; detail: string; features: Record<string, boolean>; blockedBy: string[] };
export type RuntimeView = { current: RuntimeId; changedAt: string | null; options: RuntimeOption[]; activeRelease: string | null };

const NAMES: Record<RuntimeId, string> = { owui: "Open WebUI", strands: "Strands" };

async function activeBundle(): Promise<{ releaseId: string; bundle: Bundle } | null> {
  const r = (await systemQuery("select i.active_release as id, r.bundle from stack_identity i join installed_releases r on r.release_id = i.active_release where i.singleton")).rows[0];
  return r ? { releaseId: r.id as string, bundle: r.bundle as Bundle } : null;
}

const missing = (needs: string[], features: Record<string, boolean>) => needs.filter((n) => !features[n]);

export async function runtimeView(): Promise<RuntimeView> {
  const cur = await currentRuntimeId();
  const active = await activeBundle();
  const needs = ((active?.bundle?.manifest as { runtime_capabilities?: string[] } | undefined)?.runtime_capabilities) ?? [];
  const row = (await systemQuery("select runtime_changed_at from stack_identity where singleton")).rows[0];
  const options: RuntimeOption[] = [];
  // both checks at once, and never wait more than 1.5 s: a runtime that is down must not hold the page (QA DEF-18)
  const ids: RuntimeId[] = ["owui", "strands"];
  const slow = { ok: false, detail: "did not answer within 1.5 seconds; reload to check again" };
  const health = await Promise.all(ids.map((id) => Promise.race([
    runtimeById(id).health().catch(() => ({ ok: false, detail: "not reachable" })),
    new Promise<typeof slow>((r) => setTimeout(() => r(slow), 1500)),
  ])));
  ids.forEach((id, i) => {
    const features = runtimeById(id).capabilities().capabilities as unknown as Record<string, boolean>;
    options.push({ id, name: NAMES[id], ok: health[i].ok, detail: health[i].detail, features, blockedBy: missing(needs, features) });
  });
  return { current: cur, changedAt: row?.runtime_changed_at ? new Date(row.runtime_changed_at).toISOString() : null, options, activeRelease: active?.releaseId ?? null };
}

export type SwitchResult = { ok: true; recompiled: number } | { ok: false; reason: string; problems?: string[] };

export async function switchRuntime(admin: { id: string; tenantId: string }, to: RuntimeId): Promise<SwitchResult> {
  const from = await currentRuntimeId();
  if (to === from) return { ok: true, recompiled: 0 };
  const target = runtimeById(to);

  const h = await target.health().catch(() => ({ ok: false, detail: "not reachable" }));
  if (!h.ok) return { ok: false, reason: `${NAMES[to]} is not available: ${h.detail}.` };

  const active = await activeBundle();
  if (active) {
    const needs = ((active.bundle?.manifest as { runtime_capabilities?: string[] } | undefined)?.runtime_capabilities) ?? [];
    const lacks = missing(needs, target.capabilities().capabilities as unknown as Record<string, boolean>);
    if (lacks.length) return { ok: false, reason: `${NAMES[to]} cannot run the installed capabilities.`, problems: lacks.map((f) => `they need "${f}", which ${NAMES[to]} does not provide`) };
  }

  // a real turn with this organisation's model access, so a missing or rejected key is found now and not by a student
  try {
    const out = await target.complete([{ role: "user", content: "Reply with the single word OK." }], admin.tenantId);
    if (!out.trim()) return { ok: false, reason: `${NAMES[to]} answered the test turn with nothing.` };
  } catch (e) {
    return { ok: false, reason: `${NAMES[to]} could not complete a test turn: ${(e as Error).message}` };
  }

  let recompiled = 0;
  if (active) {
    try { recompiled = (await compileInto(active.releaseId, active.bundle, target)).length; }
    catch (e) { return { ok: false, reason: `The installed capabilities could not be set up on ${NAMES[to]}: ${(e as Error).message}. Nothing was changed.` }; }
  }
  await systemQuery("update stack_identity set runtime = $1, runtime_changed_at = now() where singleton", [to]);
  forgetRuntimeChoice();
  await systemQuery("insert into stack_events (kind, release_id, detail) values ('runtime-switched', $1, $2)", [active?.releaseId ?? null, JSON.stringify({ from, to })]);
  await withTenant(admin.tenantId, (c) => auditEvent(c, { tenantId: admin.tenantId, userId: admin.id, action: "runtime.switch", entityType: "runtime", entityId: to, metadata: { from, to, recompiled } }));
  return { ok: true, recompiled };
}
