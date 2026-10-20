import { conversationStore } from "../conversations";
import { systemQuery, withTenant } from "../digi-db";
import { createSession } from "../session";
import { composeSystem, modulePrefix, policiesFor, toolModulesFor } from "../stack/compose";
import { STACK_ID } from "../stack/identity";
import { toolContractProblems } from "../stack/installer";
import { getRuntime } from "../runtime";
import type { Operator } from "./auth";
import { studioAudit } from "./db";
import { getVersions, resolveLock, StudioError } from "./store";

/**
 * The platform Test Lab (ST.4). Studio never tests against a customer's stack or data. The test stack is the very same Digi code on its own database
 * (digitest) holding one invented university and four personas. A Worker draft is compiled for the runtime exactly as an installed one would be, then run
 * AS a persona with that persona's real permissions, through the real chat path, tool gateway, Authority and job engine. What comes back is a trace: the
 * tools that were offered, each tool call with Authority's decision, what was prepared or sent for approval, and the answer. A Worker is judged by what it
 * is allowed to do for each role, not only by how well it writes.
 */
export const PERSONAS = [
  { key: "student", email: "test.student@platform.test", label: "Test Student", role: "Student" },
  { key: "faculty", email: "test.faculty@platform.test", label: "Test Faculty", role: "Faculty" },
  { key: "registrar", email: "test.registrar@platform.test", label: "Test Registrar", role: "Staff" },
  { key: "admin", email: "test.admin@platform.test", label: "Test Department Admin", role: "Admin" },
] as const;
export type PersonaKey = (typeof PERSONAS)[number]["key"];

async function testTenant(): Promise<string> {
  const r = (await systemQuery("select id from tenants where slug = 'platform-test'")).rows[0];
  if (!r) throw new StudioError("The test stack has not been set up.", 503);
  return r.id as string;
}

async function personaUser(tenantId: string, key: PersonaKey) {
  const p = PERSONAS.find((x) => x.key === key);
  if (!p) throw new StudioError("Unknown persona.", 400);
  const row = await withTenant(tenantId, async (c) => (await c.query("select id from users where email = $1", [p.email])).rows[0]);
  if (!row) throw new StudioError("That persona does not exist on the test stack.", 503);
  return { ...p, userId: row.id as string };
}

export async function personaSummary() {
  const tenantId = await testTenant();
  const out = [];
  for (const p of PERSONAS) {
    const u = await personaUser(tenantId, p.key);
    const perms = await withTenant(tenantId, async (c) => (await c.query(
      `select coalesce(array_agg(distinct rp.permission_code order by rp.permission_code) filter (where rp.permission_code is not null), '{}') as perms, bool_or(r.grants_all) as all_
         from user_roles ur join roles r on r.id = ur.role_id left join role_permissions rp on rp.role_id = r.id where ur.user_id = $1`, [u.userId])).rows[0]);
    out.push({ key: p.key, label: p.label, role: p.role, permissions: perms.all_ ? ["everything"] : perms.perms });
  }
  return out;
}

/** Compiles a Worker draft (any version) for the test stack and stages it as the "lab" Worker. Returns what it was built from. */
export async function stageDraft(workerId: string, version?: number): Promise<{ version: number; modelId: string }> {
  const versions = await getVersions(workerId);
  const v = version ? versions.find((x) => x.version === version) : versions[0];
  if (!v) throw new StudioError("That Worker does not exist.", 404);
  const r = await resolveLock(v.spec);
  const contract = toolContractProblems(Object.values(r.tools) as never);
  if (contract.length) throw new StudioError("This Worker uses a tool in a way this platform does not allow.", 400, contract);

  const runtime = await getRuntime();
  const spec = v.spec;
  const { modelId, definition } = await runtime.compileWorker({
    stack: STACK_ID(), workerId: workerId, name: String(spec.name), description: String(spec.description),
    system: composeSystem(spec, Object.values(r.skills)), baseModel: await runtime.defaultBaseModel(),
    toolModules: toolModulesFor(((spec.tools as { id: string }[]) ?? []).map((t) => t.id)),
  });
  await systemQuery(
    `insert into installed_releases (release_id, seq, channel, manifest, bundle, status) values ('lab', 0, 'stable', '{}', '{}', 'superseded') on conflict do nothing`);
  await systemQuery(
    `insert into installed_workers (release_id, worker_id, version, name, description, spec, tool_policies, compiled_model_id, runtime_def, active) values ('lab', $1, $2, $3, $4, $5, $6, $7, $8, false)
     on conflict (release_id, worker_id) do update set version = excluded.version, name = excluded.name, description = excluded.description, spec = excluded.spec, tool_policies = excluded.tool_policies, compiled_model_id = excluded.compiled_model_id, runtime_def = excluded.runtime_def`,
    [workerId, v.version, spec.name, spec.description, JSON.stringify(spec), JSON.stringify(policiesFor(spec, r.policies)), modelId, definition ? JSON.stringify(definition) : null],
  );
  return { version: v.version, modelId };
}

export type LabEvent = { at: number; type: string; text?: string };
export type LabResult = {
  persona: { key: string; label: string; role: string }; version: number; answer: string; events: LabEvent[]; conversationId: string;
  trace: {
    toolsOffered: string[]; status: string; durationMs: number | null;
    toolCalls: { tool: string; decision: string; status: string; reason: string | null }[];
    prepared: { id: string; tool: string; summary: string; status: string }[];
    approvals: { id: string; tool: string; summary: string; status: string }[];
  };
};

export async function runPersona(op: Operator, input: { workerId: string; version?: number; persona: PersonaKey; prompt: string }): Promise<LabResult> {
  const prompt = input.prompt.trim();
  if (prompt.length < 2 || prompt.length > 2000) throw new StudioError("Write what the persona says (up to 2000 characters).");
  const tenantId = await testTenant();
  const persona = await personaUser(tenantId, input.persona);
  const staged = await stageDraft(input.workerId, input.version);

  const token = await createSession(tenantId, persona.userId, { ip: "lab", userAgent: "studio test lab" });
  const conv = await conversationStore().create({ id: persona.userId, tenantId }, { agentId: `lab:${input.workerId}` });
  const t0 = Date.now();
  const events: LabEvent[] = [];
  let answer = "";
  const res = await fetch("http://127.0.0.1:3000/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: `digi_session=${token}`, Host: "127.0.0.1" },
    body: JSON.stringify({ conversationId: conv.id, text: prompt }), signal: AbortSignal.timeout(170_000),
  });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    throw new StudioError(`The test run could not start: ${(err as { error?: string }).error ?? res.status}.`, 502);
  }
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n"); buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      try {
        const j = JSON.parse(line.slice(5).trim()) as { type: string; delta?: string; label?: string; message?: string; action?: { summary: string } };
        if (j.type === "text") answer += j.delta ?? "";
        else if (j.type === "tool") events.push({ at: Date.now() - t0, type: "tool", text: j.label });
        else if (j.type === "action") events.push({ at: Date.now() - t0, type: "prepared", text: j.action?.summary });
        else if (j.type === "error") events.push({ at: Date.now() - t0, type: "error", text: j.message });
        else if (j.type === "done") events.push({ at: Date.now() - t0, type: "done" });
      } catch { /* a partial frame */ }
    }
  }

  // the trace comes from the test stack's own records, not from what the model said
  const trace = await withTenant(tenantId, async (c) => {
    const run = (await c.query("select id, status, duration_ms, tools_available from ai_runs where conversation_id = $1 order by started_at desc limit 1", [conv.id])).rows[0];
    const calls = run ? (await c.query("select tool, decision, status, reason from tool_calls where run_id = $1 order by created_at", [run.id])).rows : [];
    const prepared = (await c.query("select id, tool, summary, status from pending_actions where conversation_id = $1 order by created_at", [conv.id])).rows;
    const approvals = (await c.query(
      `select a.id, a.tool, a.summary, a.status from approvals a join jobs j on j.id = a.job_id where a.requested_by = $1 and a.created_at > now() - interval '10 minutes' order by a.created_at`, [persona.userId])).rows;
    return {
      toolsOffered: (run?.tools_available as string[]) ?? [], status: (run?.status as string) ?? "unknown", durationMs: (run?.duration_ms as number) ?? null,
      toolCalls: calls as LabResult["trace"]["toolCalls"], prepared, approvals,
    };
  });
  await studioAudit({ operatorId: op.id, action: "lab.run", entityType: "worker", entityId: `${input.workerId}@${staged.version}`, metadata: { persona: input.persona, tools: trace.toolCalls.map((c) => `${c.tool}:${c.decision}`) } });
  return { persona: { key: persona.key, label: persona.label, role: persona.role }, version: staged.version, answer, events, conversationId: conv.id, trace };
}

/** In the Test Lab an approver persona can decide an approval that another persona's run created, so the whole ASK path can be seen. */
export async function labDecide(op: Operator, input: { approvalId: string; persona: PersonaKey; decision: "approve" | "decline"; reason: string }) {
  const tenantId = await testTenant();
  const persona = await personaUser(tenantId, input.persona);
  const token = await createSession(tenantId, persona.userId, { ip: "lab", userAgent: "studio test lab" });
  const res = await fetch(`http://127.0.0.1:3000/api/approvals/${input.approvalId}/decide`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: `digi_session=${token}`, Host: "127.0.0.1" },
    body: JSON.stringify({ decision: input.decision, reason: input.reason || "Test Lab decision" }),
  });
  const out = await res.json().catch(() => ({}));
  await studioAudit({ operatorId: op.id, action: "lab.decide", entityType: "approval", entityId: input.approvalId, result: res.ok ? "success" : "denied", metadata: { persona: input.persona, decision: input.decision } });
  return { status: res.status, body: out };
}

export { modulePrefix };
