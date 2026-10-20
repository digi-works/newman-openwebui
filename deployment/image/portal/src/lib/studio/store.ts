import type { PoolClient } from "pg";
import { hashSpec } from "./crypto";
import { sq, stx, studioAudit } from "./db";
import { effectiveToolPolicies, type PolicyLike } from "./effective";
import { SCHEMA_VERSION, validateSpec, type SpecKind } from "./specs";
import type { Operator } from "./auth";

/**
 * Studio persistence (ST.3): specs and Worker versions, with the lifecycle draft -> in_review -> approved -> published -> retired.
 * The database itself refuses to change a published version (a trigger), so immutability does not depend on this code being right.
 * Every mutation writes an audit row.
 */
export class StudioError extends Error {
  constructor(message: string, readonly status = 400, readonly problems?: string[]) { super(message); }
}

const TABLE: Record<Exclude<SpecKind, "worker">, string> = { tool: "studio_tools", skill: "studio_skills", policy: "studio_policies", model_profile: "studio_model_profiles" };
export type Ref = { id: string; version: number; hash: string };
export type Lock = { schema_version: number; model_profile: Ref; tools: Ref[]; skills: Ref[]; policies: Ref[] };

export type SpecRow = { id: string; version: number; status: string; spec: Record<string, unknown>; spec_hash: string; created_at: string };

export async function listSpecs(kind: Exclude<SpecKind, "worker">): Promise<SpecRow[]> {
  return sq<SpecRow>(`select id, version, status, spec, spec_hash, created_at from ${TABLE[kind]} order by id, version desc`);
}

/** Saves a tool, skill, policy or model profile as a new version (or returns the existing one if nothing changed). */
export async function saveSpec(op: Operator, kind: Exclude<SpecKind, "worker">, spec: Record<string, unknown>): Promise<{ id: string; version: number; created: boolean }> {
  const v = validateSpec(kind, spec);
  if (!v.ok) throw new StudioError("That is not a valid spec.", 400, v.problems);
  const hash = hashSpec(spec), id = String(spec.id);
  return stx(async (c) => {
    const last = (await c.query(`select version, spec_hash from ${TABLE[kind]} where id = $1 order by version desc limit 1`, [id])).rows[0];
    if (last?.spec_hash === hash) return { id, version: last.version as number, created: false };
    const version = (last?.version ?? 0) + 1;
    await c.query(`insert into ${TABLE[kind]} (id, version, spec, spec_hash, created_by) values ($1, $2, $3, $4, $5)`, [id, version, JSON.stringify(spec), hash, op.id]);
    await studioAudit({ operatorId: op.id, action: `spec.${kind}.save`, entityType: kind, entityId: `${id}@${version}` }, c);
    return { id, version, created: true };
  });
}

/* ---------------------------------------------------------------- dependency lock */
type Row = { version: number; spec: Record<string, unknown>; spec_hash: string; status: string };

async function pick(c: PoolClient | null, table: string, id: string, version?: number): Promise<Row | null> {
  const q = version
    ? [`select version, spec, spec_hash, status from ${table} where id = $1 and version = $2`, [id, version]]
    : [`select version, spec, spec_hash, status from ${table} where id = $1 and status = 'active' order by version desc limit 1`, [id]];
  const rows = c ? (await c.query(q[0] as string, q[1] as unknown[])).rows : await sq<Row>(q[0] as string, q[1] as unknown[]);
  return (rows[0] as Row) ?? null;
}

/**
 * Resolves every reference in a Worker spec to an exact version and hash. A published Worker never changes because a Skill, Policy or Tool
 * was edited later: edits make new versions, and this lock names the ones it was built with.
 */
export async function resolveLock(spec: Record<string, unknown>, c: PoolClient | null = null): Promise<{ lock: Lock; policies: PolicyLike[]; tools: Record<string, Record<string, unknown>>; skills: Record<string, Record<string, unknown>>; profile: Record<string, unknown> }> {
  const problems: string[] = [];
  const need = async (table: string, what: string, r: { id: string; version?: number }) => {
    const row = await pick(c, table, r.id, r.version);
    if (!row) { problems.push(`${what} ${r.id}${r.version ? `@${r.version}` : ""} does not exist`); return null; }
    if (row.status !== "active" && !r.version) { problems.push(`${what} ${r.id} is deprecated`); return null; }
    return { ref: { id: r.id, version: row.version, hash: row.spec_hash } as Ref, spec: row.spec };
  };
  const mp = await need("studio_model_profiles", "model profile", spec.model_profile as { id: string; version?: number });
  const tools: Ref[] = [], skills: Ref[] = [], policies: Ref[] = [];
  const toolSpecs: Record<string, Record<string, unknown>> = {}, skillSpecs: Record<string, Record<string, unknown>> = {};
  const policySpecs: PolicyLike[] = [];
  for (const t of (spec.tools as { id: string; version?: number }[]) ?? []) { const r = await need("studio_tools", "tool", t); if (r) { tools.push(r.ref); toolSpecs[r.ref.id] = r.spec; } }
  for (const s of (spec.skills as { id: string; version?: number }[]) ?? []) { const r = await need("studio_skills", "skill", s); if (r) { skills.push(r.ref); skillSpecs[r.ref.id] = r.spec; } }
  for (const p of (spec.policies as { id: string; version?: number }[]) ?? []) { const r = await need("studio_policies", "policy", p); if (r) { policies.push(r.ref); policySpecs.push(r.spec as unknown as PolicyLike); } }
  const caps = (spec.required_runtime_capabilities as string[] | undefined) ?? [];
  if (tools.length && !caps.includes("tools")) problems.push("required_runtime_capabilities must include tools when the Worker has tools");
  for (const t of Object.values(toolSpecs)) {
    const b = t.binding as { kind: string };
    if (b.kind === "mcp" && !caps.includes("mcp")) problems.push(`tool ${String(t.id)} is an MCP tool, so required_runtime_capabilities must include mcp`);
  }
  if (problems.length || !mp) throw new StudioError("This Worker cannot be built as written.", 400, problems);
  return { lock: { schema_version: SCHEMA_VERSION, model_profile: mp.ref, tools, skills, policies }, policies: policySpecs, tools: toolSpecs, skills: skillSpecs, profile: mp.spec };
}

/** What the Worker may do, as a reviewer should see it: each tool, its risk, and the effective policy after every Policy is applied. */
export async function previewAuthority(spec: Record<string, unknown>) {
  const r = await resolveLock(spec);
  const eff = effectiveToolPolicies(spec.tools as { id: string; policy: "allow" | "ask" | "deny" }[], r.policies);
  return (spec.tools as { id: string }[]).map((t) => ({
    tool: t.id, title: String(r.tools[t.id]?.title ?? t.id), risk: String(r.tools[t.id]?.risk ?? ""), permission: String(r.tools[t.id]?.permission ?? ""),
    declared: (spec.tools as { id: string; policy: string }[]).find((x) => x.id === t.id)!.policy, effective: eff[t.id],
    needsApprovalAnyway: r.tools[t.id]?.risk === "high_impact",
  }));
}

/* ---------------------------------------------------------------- Workers */
export type WorkerVersion = { worker_id: string; version: number; status: string; spec: Record<string, unknown>; spec_hash: string; lock: Lock | null; source: string; created_at: string; published_at: string | null };

export async function listWorkers() {
  return sq<{ id: string; name: string; latest: number; status: string; published: number | null; updated: string }>(
    `select w.id, w.name,
            (select max(version) from studio_worker_versions v where v.worker_id = w.id) as latest,
            (select status from studio_worker_versions v where v.worker_id = w.id order by version desc limit 1) as status,
            (select max(version) from studio_worker_versions v where v.worker_id = w.id and v.status = 'published') as published,
            coalesce((select max(created_at) from studio_worker_versions v where v.worker_id = w.id), w.created_at) as updated
       from studio_workers w where not w.archived order by w.name`,
  );
}

export async function getVersions(workerId: string): Promise<WorkerVersion[]> {
  return sq<WorkerVersion>("select worker_id, version, status, spec, spec_hash, lock, source, created_at, published_at from studio_worker_versions where worker_id = $1 order by version desc", [workerId]);
}

/**
 * Saves a draft. If the newest version is not yet published it is edited in place (and drops back to draft, so an earlier review no longer
 * applies); if it is published, a new version starts. Generated drafts arrive the same way and carry source = 'generated'.
 */
export async function saveDraft(op: Operator, spec: Record<string, unknown>, source: "manual" | "generated" = "manual"): Promise<{ workerId: string; version: number }> {
  const v = validateSpec("worker", spec);
  if (!v.ok) throw new StudioError("That Worker spec is not valid.", 400, v.problems);
  const workerId = String(spec.id), hash = hashSpec(spec);
  return stx(async (c) => {
    if (!(await c.query("select 1 from studio_workers where id = $1", [workerId])).rows[0]) {
      await c.query("insert into studio_workers (id, name, created_by) values ($1, $2, $3)", [workerId, String(spec.name), op.id]);
      await studioAudit({ operatorId: op.id, action: "worker.create", entityType: "worker", entityId: workerId }, c);
    } else {
      await c.query("update studio_workers set name = $2 where id = $1", [workerId, String(spec.name)]);
    }
    const last = (await c.query("select version, status, spec_hash from studio_worker_versions where worker_id = $1 order by version desc limit 1 for update", [workerId])).rows[0];
    let version: number;
    if (last && !["published", "retired"].includes(last.status)) {
      version = last.version;
      if (last.spec_hash !== hash) await c.query("update studio_worker_versions set spec = $3, spec_hash = $4, status = 'draft', source = $5 where worker_id = $1 and version = $2", [workerId, version, JSON.stringify(spec), hash, source]);
    } else {
      version = (last?.version ?? 0) + 1;
      await c.query("insert into studio_worker_versions (worker_id, version, spec, spec_hash, source, created_by) values ($1, $2, $3, $4, $5, $6)", [workerId, version, JSON.stringify(spec), hash, source, op.id]);
    }
    await studioAudit({ operatorId: op.id, action: "worker.draft.save", entityType: "worker", entityId: `${workerId}@${version}`, metadata: { source } }, c);
    return { workerId, version };
  });
}

async function load(c: PoolClient, workerId: string, version: number) {
  const r = (await c.query("select * from studio_worker_versions where worker_id = $1 and version = $2 for update", [workerId, version])).rows[0];
  if (!r) throw new StudioError("That Worker version does not exist.", 404);
  return r as { status: string; spec: Record<string, unknown>; spec_hash: string };
}

export async function submitForReview(op: Operator, workerId: string, version: number) {
  await stx(async (c) => {
    const r = await load(c, workerId, version);
    if (r.status !== "draft") throw new StudioError(`This version is ${r.status}, not a draft.`, 409);
    await resolveLock(r.spec, c); // refuse early if it cannot be built
    await c.query("update studio_worker_versions set status = 'in_review' where worker_id = $1 and version = $2", [workerId, version]);
    await studioAudit({ operatorId: op.id, action: "worker.review.request", entityType: "worker", entityId: `${workerId}@${version}` }, c);
  });
}

export const REVIEW_CHECKLIST = ["instructions_read", "tools_reviewed", "authority_reviewed"] as const;

/** A human reviews exactly the spec they were shown (its hash). Approving without ticking every item is refused. */
export async function recordReview(op: Operator, workerId: string, version: number, input: { decision: "approve" | "reject"; specHash: string; checklist: Record<string, boolean>; note?: string }) {
  await stx(async (c) => {
    const r = await load(c, workerId, version);
    if (r.status !== "in_review") throw new StudioError("This version is not waiting for review.", 409);
    if (input.specHash !== r.spec_hash) throw new StudioError("The Worker changed since you opened it. Open it again and review what is there now.", 409);
    if (input.decision === "approve" && !REVIEW_CHECKLIST.every((k) => input.checklist[k] === true)) throw new StudioError("Confirm each review item before approving.", 400);
    await c.query("insert into studio_reviews (worker_id, version, reviewer_id, spec_hash, checklist, decision, note) values ($1, $2, $3, $4, $5, $6, $7)",
      [workerId, version, op.id, r.spec_hash, JSON.stringify(input.checklist), input.decision, (input.note ?? "").slice(0, 1000)]);
    await c.query("update studio_worker_versions set status = $3 where worker_id = $1 and version = $2", [workerId, version, input.decision === "approve" ? "approved" : "draft"]);
    await studioAudit({ operatorId: op.id, action: `worker.review.${input.decision}`, entityType: "worker", entityId: `${workerId}@${version}` }, c);
  });
}

/** Freezes the version: needs an approval of this exact content, resolves the dependency lock, and from then on the content cannot change. */
export async function publishVersion(op: Operator, workerId: string, version: number): Promise<Lock> {
  return stx(async (c) => {
    const r = await load(c, workerId, version);
    if (r.status !== "approved") throw new StudioError("A human review has to approve this version before it can be published.", 409);
    const rev = (await c.query("select spec_hash from studio_reviews where worker_id = $1 and version = $2 and decision = 'approve' order by id desc limit 1", [workerId, version])).rows[0];
    if (!rev || rev.spec_hash !== r.spec_hash) throw new StudioError("The approval is for different content. Review it again.", 409);
    const v = validateSpec("worker", r.spec);
    if (!v.ok) throw new StudioError("The spec is no longer valid.", 400, v.problems);
    const { lock } = await resolveLock(r.spec, c);
    await c.query("update studio_worker_versions set status = 'published', lock = $3, published_at = now() where worker_id = $1 and version = $2", [workerId, version, JSON.stringify(lock)]);
    await studioAudit({ operatorId: op.id, action: "worker.publish", entityType: "worker", entityId: `${workerId}@${version}`, metadata: { spec_hash: r.spec_hash } }, c);
    return lock;
  });
}

export async function retireVersion(op: Operator, workerId: string, version: number) {
  await stx(async (c) => {
    const r = await load(c, workerId, version);
    if (r.status !== "published") throw new StudioError("Only a published version can be retired.", 409);
    await c.query("update studio_worker_versions set status = 'retired' where worker_id = $1 and version = $2", [workerId, version]);
    await studioAudit({ operatorId: op.id, action: "worker.retire", entityType: "worker", entityId: `${workerId}@${version}` }, c);
  });
}

export async function reviewsFor(workerId: string, version: number) {
  return sq<{ reviewer: string; decision: string; note: string; created_at: string; spec_hash: string }>(
    "select o.name as reviewer, r.decision, r.note, r.created_at, r.spec_hash from studio_reviews r join platform_operators o on o.id = r.reviewer_id where r.worker_id = $1 and r.version = $2 order by r.id desc", [workerId, version]);
}
