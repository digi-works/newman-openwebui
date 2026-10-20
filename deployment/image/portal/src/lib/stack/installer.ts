import { systemQuery, withTenant } from "../digi-db";
import { canonicalJson, sha256Hex } from "../release/common";
import { trustedRoots } from "../release/trust";
import { verifyBundle, verifyRevocationList, type Bundle, type RevocationList } from "../release/verify";
import { getRuntime } from "../runtime";
import type { RuntimeAdapter } from "../runtime";
import type { CapabilityFlags } from "../runtime/types";
import { validateSpec, findForbiddenContent, type SpecKind } from "../studio/specs";
import { getTool } from "../tools/registry";
import { composeSystem, modulePrefix, policiesFor, toolModulesFor } from "./compose";
import { DIGI_VERSION, getIdentity, signedGet, STACK_ID, StackError } from "./identity";

/**
 * The customer installer (ST.8). A release is pulled, then in this order: signature and revocation, anti-rollback, compatibility (Digi version, runtime
 * features), content rules (no secrets, valid specs, a consistent dependency lock), tool contracts (a bundle can neither understate a tool's risk nor
 * name a different permission than this stack's own), then it waits for an Admin (or installs itself, or waits out a security grace period, by the
 * customer's update setting), is bound to this stack (the customer's model), compiled by the runtime and activated. A bundle that fails any step is
 * never activated. Rollback moves the active pointer to the previous release; it does not rebuild anything from the platform.
 */
const RISK: Record<string, number> = { read: 0, write: 1, high_impact: 2 };
const semver = (v: string) => v.split(".").map((n) => Number.parseInt(n, 10) || 0);
const semverLt = (a: string, b: string) => { const x = semver(a), y = semver(b); for (let i = 0; i < 3; i++) { if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0); } return false; };

export type Rel = {
  releaseId: string; seq: number; channel: string; securityCritical: boolean; manifest: Record<string, unknown>; status: string; reason: string | null;
  pulledAt: string; activatedAt: string | null; graceDeadline: string | null;
};
const rel = (r: Record<string, unknown>): Rel => ({
  releaseId: r.release_id as string, seq: Number(r.seq), channel: r.channel as string, securityCritical: r.security_critical as boolean, manifest: r.manifest as Record<string, unknown>,
  status: r.status as string, reason: (r.reason as string) ?? null, pulledAt: new Date(r.pulled_at as string).toISOString(),
  activatedAt: r.activated_at ? new Date(r.activated_at as string).toISOString() : null, graceDeadline: r.grace_deadline ? new Date(r.grace_deadline as string).toISOString() : null,
});

export async function listReleases(): Promise<Rel[]> {
  return (await systemQuery("select release_id, seq, channel, security_critical, manifest, status, reason, pulled_at, activated_at, grace_deadline from installed_releases order by seq desc")).rows.map(rel);
}

async function event(kind: string, releaseId: string | null, detail: Record<string, unknown> = {}) {
  await systemQuery("insert into stack_events (kind, release_id, detail) values ($1, $2, $3)", [kind, releaseId, JSON.stringify(detail)]);
}

/** Tells every tenant's Admins in the app (no email in Phase 1). */
async function notifyAdmins(title: string, body: string, href = "/settings/updates") {
  const tenants = (await systemQuery("select id from tenants where status = 'active'")).rows;
  for (const t of tenants) {
    await withTenant(t.id, async (c) => {
      await c.query(
        `insert into notifications (tenant_id, user_id, kind, title, body, href)
         select $1, u.id, 'ai-updates', $2, $3, $4 from users u join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id where r.grants_all and u.status = 'active'`,
        [t.id, title, body.slice(0, 500), href],
      );
    }).catch((e) => console.error("notifying admins failed", e.message));
  }
}

/* ---------------------------------------------------------------- checks */
export async function problemsFor(bundle: Bundle, o: { revokedKeys: Set<string>; revokedReleases: Set<string>; minAllowedSeq: number }): Promise<string[]> {
  const v = verifyBundle(bundle, { roots: trustedRoots(), revokedKeys: o.revokedKeys, revokedReleases: o.revokedReleases });
  if (!v.ok) return [v.reason];
  const problems: string[] = [];
  const m = bundle.manifest as { release_id: string; seq: number; digi_min_version: string; runtime_capabilities: string[]; workers: { id: string; version: number }[]; min_allowed_seq?: number };

  if (m.seq < o.minAllowedSeq) problems.push(`this release (${m.release_id}) is older than the minimum this stack accepts`);
  if (semverLt(DIGI_VERSION(), m.digi_min_version)) problems.push(`it needs Digi ${m.digi_min_version} or newer, and this stack runs ${DIGI_VERSION()}`);
  const caps = (await getRuntime()).capabilities().capabilities as unknown as Record<string, boolean>;
  for (const need of m.runtime_capabilities ?? []) if (!caps[need]) problems.push(`it needs "${need}", which this stack's AI runtime does not provide`);

  const forbidden = findForbiddenContent({ manifest: bundle.manifest, lock: bundle.lock, files: Object.fromEntries(Object.entries(bundle.files).filter(([k]) => !k.startsWith("schemas/"))) });
  problems.push(...forbidden.map((f) => `content rule: ${f}`));

  const folderKind: [string, SpecKind][] = [["workers/", "worker"], ["skills/", "skill"], ["policies/", "policy"], ["tool-requirements/", "tool"], ["model-requirements/", "model_profile"]];
  for (const [path, spec] of Object.entries(bundle.files)) {
    if (path.startsWith("schemas/")) continue;
    const kind = folderKind.find(([p]) => path.startsWith(p))?.[1];
    if (!kind) { problems.push(`unexpected file ${path}`); continue; }
    const r = validateSpec(kind, spec);
    if (!r.ok) problems.push(`${path}: ${r.problems.join("; ")}`);
  }

  // the lock must describe exactly the files that came with the bundle
  const lock = bundle.lock as { workers?: Record<string, { version: number; spec_hash: string; lock: { tools: Ref[]; skills: Ref[]; policies: Ref[]; model_profile: Ref } }> };
  type Ref = { id: string; version: number; hash: string };
  const hashOf = (p: string) => (bundle.files[p] ? sha256Hex(canonicalJson(bundle.files[p])) : null);
  for (const w of m.workers ?? []) {
    const l = lock.workers?.[w.id];
    if (!l) { problems.push(`the lock has no entry for ${w.id}`); continue; }
    if (hashOf(`workers/${w.id}.json`) !== l.spec_hash) problems.push(`the Worker ${w.id} does not match its lock`);
    for (const [folder, refs] of [["tool-requirements", l.lock.tools], ["skills", l.lock.skills], ["policies", l.lock.policies], ["model-requirements", [l.lock.model_profile]]] as [string, Ref[]][]) {
      for (const r of refs) if (hashOf(`${folder}/${r.id}.json`) !== r.hash) problems.push(`${folder}/${r.id} does not match its lock`);
    }
  }

  problems.push(...toolContractProblems(Object.entries(bundle.files).filter(([k]) => k.startsWith("tool-requirements/")).map(([, v]) => v as ToolReq)));
  return problems;
}

type ToolReq = { id: string; risk: string; permission: string; binding: { kind: string; tool: string } };

/** Tool contracts: a bundle (or a draft) cannot understate a tool's risk or name a different permission than this stack's own. */
export function toolContractProblems(tools: ToolReq[]): string[] {
  const problems: string[] = [];
  for (const t of tools) {
    if (t.binding.kind !== "digi_native") { problems.push(`tool ${t.id} needs a tool connection (${t.binding.kind}), which cannot be bound automatically yet`); continue; }
    const local = getTool(t.binding.tool);
    if (!local) { problems.push(`it needs the tool ${t.binding.tool}, which this stack does not have`); continue; }
    if ((RISK[t.risk] ?? 0) < RISK[local.risk]!) problems.push(`tool ${t.id} claims a lower risk (${t.risk}) than this stack's own (${local.risk})`);
    if (t.permission !== local.permission) problems.push(`tool ${t.id} names the permission ${t.permission}, but this stack requires ${local.permission}`);
  }
  return problems;
}

async function revocationState() {
  const r = (await systemQuery("select list from stack_revocations where singleton")).rows[0]?.list as RevocationList | null;
  if (!r) return { keys: new Set<string>(), releases: new Set<string>() };
  const v = verifyRevocationList(r, trustedRoots());
  return v.ok ? { keys: v.keys, releases: v.releases } : { keys: new Set<string>(), releases: new Set<string>() };
}

/* ---------------------------------------------------------------- staging */
export type StageResult = { releaseId: string; status: "pending_approval" | "active" | "rejected" | "known" | "failed"; reason?: string };

export async function stageBundle(bundle: Bundle): Promise<StageResult> {
  const releaseId = String(bundle?.manifest?.release_id ?? "");
  if (!/^r-\d{4,}$/.test(releaseId)) return { releaseId, status: "rejected", reason: "this is not a release bundle" };
  if ((await systemQuery("select 1 from installed_releases where release_id = $1", [releaseId])).rows[0]) return { releaseId, status: "known" };

  const id = await getIdentity();
  const rev = await revocationState();
  const problems = await problemsFor(bundle, { revokedKeys: rev.keys, revokedReleases: rev.releases, minAllowedSeq: id.minAllowedSeq });
  const m = bundle.manifest as { seq?: number; channel?: string; security_critical?: boolean; grace_days?: number; min_allowed_seq?: number };
  if (problems.length) {
    await systemQuery("insert into installed_releases (release_id, seq, channel, security_critical, manifest, bundle, status, reason) values ($1, $2, $3, false, $4, $5, 'rejected', $6)",
      [releaseId, Number(m.seq) || 0, String(m.channel ?? "stable"), JSON.stringify(bundle.manifest ?? {}), JSON.stringify(bundle), problems.join("; ").slice(0, 2000)]);
    await event("rejected", releaseId, { problems });
    await notifyAdmins("A platform update was refused", `Release ${releaseId} did not pass this stack's checks and was not installed.`);
    return { releaseId, status: "rejected", reason: problems[0] };
  }
  const grace = m.security_critical ? new Date(Date.now() + (m.grace_days ?? 7) * 86400_000).toISOString() : null;
  await systemQuery(
    "insert into installed_releases (release_id, seq, channel, security_critical, manifest, bundle, status, grace_deadline) values ($1, $2, $3, $4, $5, $6, 'pending_approval', $7)",
    [releaseId, m.seq, m.channel, !!m.security_critical, JSON.stringify(bundle.manifest), JSON.stringify(bundle), grace],
  );
  if ((m.min_allowed_seq ?? 0) > id.minAllowedSeq) await systemQuery("update stack_identity set min_allowed_seq = $1 where singleton", [m.min_allowed_seq]);
  await event("staged", releaseId, { security_critical: !!m.security_critical });

  if (id.updateMode === "auto") {
    const r = await activateRelease(releaseId, null);
    return r.ok ? { releaseId, status: "active" } : { releaseId, status: "failed", reason: r.reason };
  }
  await notifyAdmins(m.security_critical ? "A security update is waiting for you" : "An AI update is waiting for your approval", `Release ${releaseId} passed all checks. ${m.security_critical ? "It will install by itself after the 7-day grace period." : "Review it and approve it when you are ready."}`);
  return { releaseId, status: "pending_approval" };
}

/* ---------------------------------------------------------------- activation */
export async function activateRelease(releaseId: string, by: string | null, mode: "install" | "rollback" = "install"): Promise<{ ok: true } | { ok: false; reason: string }> {
  const row = (await systemQuery("select * from installed_releases where release_id = $1", [releaseId])).rows[0];
  if (!row) return { ok: false, reason: "That release is not installed here." };
  const okStatus = mode === "rollback" ? ["superseded"] : ["pending_approval", "failed"];
  if (!okStatus.includes(row.status)) return { ok: false, reason: `This release is ${String(row.status).replace("_", " ")}, so it cannot be ${mode === "rollback" ? "rolled back to" : "installed"}.` };
  const id = await getIdentity();
  const rev = await revocationState();
  // checked again now, with the latest revocations, not only when it was pulled
  const bundle = row.bundle as Bundle;
  const problems = await problemsFor(bundle, { revokedKeys: rev.keys, revokedReleases: rev.releases, minAllowedSeq: mode === "rollback" ? 0 : id.minAllowedSeq });
  if (problems.length) {
    await systemQuery("update installed_releases set status = $2, reason = $3 where release_id = $1", [releaseId, rev.releases.has(releaseId) ? "revoked" : "rejected", problems.join("; ").slice(0, 2000)]);
    await event("activation-refused", releaseId, { problems });
    return { ok: false, reason: problems[0]! };
  }

  const runtime = await getRuntime();
  let compiled: { id: string; modelId: string }[] = [];
  try {
    compiled = await compileInto(releaseId, bundle, runtime, true);
  } catch (e) {
    await systemQuery("update installed_releases set status = 'failed', reason = $2 where release_id = $1", [releaseId, (e as Error).message.slice(0, 500)]);
    await event("compile-failed", releaseId, { error: (e as Error).message });
    // put the previous release's Workers back, so a failed install never leaves a half-installed mix
    if (id.activeRelease) await restoreCompiled(id.activeRelease).catch(() => undefined);
    return { ok: false, reason: "The AI service could not set up this release. The previous one is still running." };
  }

  // flip: this release's Workers become the active ones; Workers the previous release had and this one does not are removed
  const prev = id.activeRelease;
  const prevWorkers = prev ? (await systemQuery("select worker_id, compiled_model_id from installed_workers where release_id = $1", [prev])).rows : [];
  await systemQuery("update installed_workers set active = false where release_id <> 'lab' and release_id <> $1", [releaseId]);
  await systemQuery("update installed_workers set active = true where release_id = $1", [releaseId]);
  if (prev && prev !== releaseId) await systemQuery("update installed_releases set status = $2 where release_id = $1 and status = 'active'", [prev, mode === "rollback" ? "rolled_back" : "superseded"]);
  await systemQuery("update installed_releases set status = 'active', activated_at = now(), approved_by = $2, approved_at = now(), reason = null where release_id = $1", [releaseId, by]);
  await systemQuery("update stack_identity set active_release = $1, previous_release = $2 where singleton", [releaseId, prev && prev !== releaseId ? prev : id.previousRelease]);
  for (const pw of prevWorkers) if (!compiled.some((c) => c.id === pw.worker_id)) await runtime.removeWorker(pw.compiled_model_id).catch(() => undefined);
  await event(mode === "rollback" ? "rolled-back" : "activated", releaseId, { by, previous: prev });
  return { ok: true };
}

/**
 * Compiles every Worker in a bundle for a runtime and records the result with the installed Worker (binding it to the customer's own model, never one named
 * in a bundle). Used when installing, when putting a release back after a failed install, and when the stack's runtime is switched.
 */
export async function compileInto(releaseId: string, bundle: Bundle, runtime: RuntimeAdapter, registerCapabilities = false): Promise<{ id: string; modelId: string }[]> {
  const files = bundle.files as Record<string, Record<string, unknown>>;
  const workers = (bundle.manifest as { workers: { id: string; version: number }[] }).workers;
  const baseModel = await runtime.defaultBaseModel();
  const out: { id: string; modelId: string }[] = [];
  for (const w of workers) {
    const spec = files[`workers/${w.id}.json`]!;
    const lock = (bundle.lock as { workers: Record<string, { lock: { skills: { id: string }[]; policies: { id: string }[] } }> }).workers[w.id]!.lock;
    const skills = lock.skills.map((s) => files[`skills/${s.id}.json`]!);
    const policies = lock.policies.map((p) => files[`policies/${p.id}.json`] as never);
    const toolIds = ((spec.tools as { id: string }[]) ?? []).map((t) => t.id);
    const { modelId, definition } = await runtime.compileWorker({
      stack: STACK_ID(), workerId: w.id, name: String(spec.name), description: String(spec.description), system: composeSystem(spec, skills),
      baseModel, toolModules: toolModulesFor(toolIds),
    });
    out.push({ id: w.id, modelId });
    await systemQuery(
      `insert into installed_workers (release_id, worker_id, version, name, description, spec, tool_policies, compiled_model_id, runtime_def, active) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, false)
       on conflict (release_id, worker_id) do update set spec = excluded.spec, tool_policies = excluded.tool_policies, compiled_model_id = excluded.compiled_model_id, runtime_def = excluded.runtime_def`,
      [releaseId, w.id, w.version, spec.name, spec.description, JSON.stringify(spec), JSON.stringify(policiesFor(spec, policies)), modelId, definition ? JSON.stringify(definition) : null],
    );
    if (registerCapabilities) {
      const perm = (await systemQuery("select register_capability_permission($1, $2, $3) as code", [w.id, String(spec.name), String(spec.description)])).rows[0].code as string;
      await systemQuery("select register_worker_capability($1, $2, $3, $4)", [w.id, String(spec.name), String(spec.description), perm]);
    }
  }
  return out;
}

/** Recompiles a release's Workers from the bundle stored here (used to put things back after a failed install, and for rollback). */
async function restoreCompiled(releaseId: string) {
  const row = (await systemQuery("select bundle from installed_releases where release_id = $1", [releaseId])).rows[0];
  if (row) await compileInto(releaseId, row.bundle as Bundle, await getRuntime());
}

export async function rollback(by: string): Promise<{ ok: true; releaseId: string } | { ok: false; reason: string }> {
  const id = await getIdentity();
  if (!id.previousRelease) return { ok: false, reason: "There is no earlier release to go back to." };
  const r = await activateRelease(id.previousRelease, by, "rollback");
  return r.ok ? { ok: true, releaseId: id.previousRelease } : r;
}

export async function approveRelease(by: string, releaseId: string) {
  const r = await activateRelease(releaseId, by);
  if (r.ok) await notifyAdmins("AI update installed", `Release ${releaseId} is now active.`);
  return r;
}

export async function rejectRelease(releaseId: string, reason: string) {
  const r = await systemQuery("update installed_releases set status = 'rejected', reason = $2 where release_id = $1 and status = 'pending_approval'", [releaseId, reason.slice(0, 300) || "Declined by an Admin."]);
  if (!r.rowCount) throw new StackError("That release is not waiting for a decision.", 409);
  await event("declined", releaseId, { reason });
}

export async function setUpdateSettings(s: { mode?: string; channel?: string; pinned?: string | null }) {
  if (s.mode && !["approval", "auto", "pin"].includes(s.mode)) throw new StackError("Choose approval, auto or pin.");
  if (s.channel && !["stable", "preview"].includes(s.channel)) throw new StackError("Choose stable or preview.");
  await systemQuery(
    "update stack_identity set update_mode = coalesce($1, update_mode), channel = coalesce($2, channel), pinned_release = case when $1 = 'pin' then active_release else null end where singleton",
    [s.mode ?? null, s.channel ?? null],
  );
}

/* ---------------------------------------------------------------- the pull */
async function applyRevocations() {
  const rev = await revocationState();
  const id = await getIdentity();
  for (const r of await listReleases()) {
    if (!["active", "pending_approval", "superseded"].includes(r.status)) continue;
    const full = (await systemQuery("select bundle from installed_releases where release_id = $1", [r.releaseId])).rows[0].bundle as Bundle;
    const v = verifyBundle(full, { roots: trustedRoots(), revokedKeys: rev.keys, revokedReleases: rev.releases });
    if (v.ok || !/revoked/.test(v.reason)) continue;
    await systemQuery("update installed_releases set status = 'revoked', reason = $2 where release_id = $1", [r.releaseId, v.reason]);
    await event("revoked", r.releaseId, { reason: v.reason });
    if (r.status === "active") {
      // proposal accepted: alert, and fall back to the previous good release if there is one; otherwise switch the revoked Workers off
      const prevId = id.previousRelease;
      const prev = prevId ? (await listReleases()).find((x) => x.releaseId === prevId) : null;
      let fell = false;
      if (prev && prev.status === "superseded") fell = (await activateRelease(prev.releaseId, null, "rollback")).ok;
      if (!fell) {
        const ws = (await systemQuery("select compiled_model_id from installed_workers where release_id = $1 and active", [r.releaseId])).rows;
        await systemQuery("update installed_workers set active = false where release_id = $1", [r.releaseId]);
        await systemQuery("update stack_identity set active_release = null where singleton and active_release = $1", [r.releaseId]);
        for (const w of ws) await (await getRuntime()).removeWorker(w.compiled_model_id).catch(() => undefined);
      }
      await notifyAdmins("An AI release was revoked by the platform", fell ? `Release ${r.releaseId} was revoked. The previous release is running instead.` : `Release ${r.releaseId} was revoked and has been switched off.`);
    }
  }
}

export type CheckResult = { status: "not_enrolled" | "up_to_date" | "staged" | "installed" | "rejected" | "error"; detail?: string; releaseId?: string };

export async function checkForUpdates(): Promise<CheckResult> {
  const id = await getIdentity();
  if (!id.installationId) return { status: "not_enrolled" };
  const stamp = async (err: string | null) => { await systemQuery("update stack_identity set last_check_at = now(), last_check_error = $1 where singleton", [err]); };
  try {
    const caps = (await getRuntime()).capabilities().capabilities as unknown as CapabilityFlags;
    const headers = { "x-digi-version": DIGI_VERSION(), "x-current-release": id.activeRelease ?? "", "x-runtime-capabilities": JSON.stringify(caps) };

    // 1. the signed revocation list first, so a revoked release is never newly activated
    const rr = await signedGet("/api/release/revocations", headers);
    if (rr.ok) {
      const list = (await rr.json()) as RevocationList;
      const v = verifyRevocationList(list, trustedRoots());
      if (v.ok) { await systemQuery("update stack_revocations set list = $1, fetched_at = now() where singleton", [JSON.stringify(list)]); await applyRevocations(); }
      else await event("revocation-list-refused", null, { reason: v.reason });
    } else if (rr.status === 401) { await stamp("The platform no longer recognises this installation."); return { status: "error", detail: "The platform no longer recognises this installation." }; }

    // 2. enforce the security grace period whatever the customer's setting
    for (const r of await listReleases()) {
      if (r.status === "pending_approval" && r.securityCritical && r.graceDeadline && new Date(r.graceDeadline) < new Date()) {
        const a = await activateRelease(r.releaseId, null);
        await event("grace-ended", r.releaseId, { activated: a.ok });
        if (a.ok) await notifyAdmins("A security update was installed", `The 7-day grace period for release ${r.releaseId} ended, so it was installed.`);
      }
    }

    // 3. is there something newer?
    const fresh = await getIdentity();
    const lr = await signedGet(`/api/release/releases/${fresh.channel}/latest`, headers);
    if (!lr.ok) { await stamp(`The release service answered ${lr.status}.`); return { status: "error", detail: `The release service answered ${lr.status}.` }; }
    const latest = (await lr.json()) as { none?: boolean; release_id?: string; seq?: number; security_critical?: boolean; download?: string };
    await stamp(null);
    if (latest.none || !latest.release_id || !latest.download) return { status: "up_to_date" };
    const current = fresh.activeRelease ? (await listReleases()).find((r) => r.releaseId === fresh.activeRelease) : null;
    if (current && (latest.seq ?? 0) <= current.seq) return { status: "up_to_date" };
    if ((await systemQuery("select 1 from installed_releases where release_id = $1", [latest.release_id])).rows[0]) return { status: "up_to_date" };
    // pinned stacks ignore ordinary releases; a security-critical one is still pulled, and installs when its grace period ends
    if (fresh.updateMode === "pin" && !latest.security_critical) return { status: "up_to_date", detail: "pinned" };

    const br = await signedGet(latest.download, headers);
    if (!br.ok) return { status: "error", detail: `The bundle download answered ${br.status}.` };
    const staged = await stageBundle((await br.json()) as Bundle);
    if (staged.status === "rejected" || staged.status === "failed") return { status: "rejected", releaseId: staged.releaseId, detail: staged.reason };
    return { status: staged.status === "active" ? "installed" : "staged", releaseId: staged.releaseId };
  } catch (e) {
    const msg = e instanceof StackError ? e.message : "Could not reach the release service.";
    await stamp(msg).catch(() => undefined);
    return { status: "error", detail: msg };
  }
}

export { modulePrefix };
