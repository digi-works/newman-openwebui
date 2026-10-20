import { hashSpec } from "./crypto";
import { sq, studioAudit } from "./db";
import { SCHEMA_VERSION, validateSpec } from "./specs";
import { TOOL_VIEWS } from "../tools/views";

/**
 * The starting catalogue: ToolSpecs for the tools a Digi stack can run natively, one Skill, one Policy and one Model Profile.
 * Studio operators register tools by choosing from what the platform's Tool Gateway really provides ("digi_native"), or by describing an MCP
 * tool; they cannot invent a native tool, because a native tool is code in the core. Loaded once, idempotently, when Studio starts.
 */
export async function ensureBuiltinCatalog() {
  const put = async (table: string, spec: { id: string }, what: string) => {
    const check = validateSpec(table === "studio_tools" ? "tool" : table === "studio_skills" ? "skill" : table === "studio_policies" ? "policy" : "model_profile", spec);
    if (!check.ok) throw new Error(`built-in ${what} ${spec.id} is invalid: ${check.problems.join("; ")}`);
    await sq(`insert into ${table} (id, version, spec, spec_hash) values ($1, 1, $2, $3) on conflict do nothing`, [spec.id, JSON.stringify(spec), hashSpec(spec)]);
  };
  const before = Number((await sq<{ n: string }>("select count(*) as n from studio_tools"))[0]!.n);
  for (const t of TOOL_VIEWS) {
    await put("studio_tools", {
      schema_version: SCHEMA_VERSION, id: t.id, title: t.title, description: t.description, risk: t.risk, permission: t.permission, input_schema: t.input,
      binding: { kind: "digi_native", tool: t.id },
    } as never, "tool");
  }
  await put("studio_skills", {
    schema_version: SCHEMA_VERSION, id: "campus-tone", title: "Campus tone",
    content: "Write in plain, friendly language that a first-year student or a busy staff member can follow. Be brief. Say what you did and what happens next. Never promise something a person still has to confirm or approve.",
  } as never, "skill");
  await put("studio_policies", {
    schema_version: SCHEMA_VERSION, id: "no-decisions", title: "Never decide for people",
    tool_policies: { "approvals.queue": "allow" }, default: "allow",
  } as never, "policy");
  await put("studio_model_profiles", {
    schema_version: SCHEMA_VERSION, id: "standard-tool-chat", title: "Standard tool-using chat",
    requirements: { tool_calling: true, streaming: true, min_context_tokens: 16000 }, hints: { reasoning: "medium", speed: "balanced" },
  } as never, "model profile");
  const after = Number((await sq<{ n: string }>("select count(*) as n from studio_tools"))[0]!.n);
  if (after > before) await studioAudit({ actor: "system", action: "catalog.seed", metadata: { tools: after - before } });
}
