import { withTenant } from "../digi-db";
import type { Actor } from "../booking-service";
import { authorize, type Decision, type ToolRule, type WorkerPolicy } from "../authority";
import { allTools, getTool, type ToolDef } from "./registry";
import { buildMcpTool, enabledMcpTools, mcpToolId, resolveMcpTool } from "./mcp-tools";

/**
 * Which tools a person may use. The registry (code) says what a tool is and what permission guards it; the database says whether the
 * organisation has switched it off and whether its policy was changed to ask or deny. The Authority engine combines them with the person's
 * live permissions. This is used twice: to choose which tools an AI turn is offered (M5.5) and again when a tool is actually called.
 * MCP tools (M5.9) come from the tenant's registry and go through exactly the same decision.
 */
const cache = new Map<string, { at: number; rows: Map<string, { enabled: boolean; policy: ToolRule["policy"] }> }>();

async function tenantRows(tenantId: string) {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < 5_000) return hit.rows;
  const rows = await withTenant(tenantId, async (c) => {
    const { rows } = await c.query(
      `select c.id, coalesce(t.enabled, c.default_enabled) as enabled, coalesce(t.policy, c.default_policy) as policy
         from capabilities c left join tenant_capabilities t on t.capability_id = c.id and t.tenant_id = $1 where c.kind = 'tool'`,
      [tenantId],
    );
    return new Map(rows.map((r) => [r.id as string, { enabled: r.enabled as boolean, policy: r.policy as ToolRule["policy"] }]));
  });
  cache.set(tenantId, { at: Date.now(), rows });
  return rows;
}

export async function capabilityEnabled(tenantId: string, id: string): Promise<boolean> {
  return (await tenantRows(tenantId)).get(id)?.enabled ?? false;
}

export const clearRulesCache = (tenantId?: string) => (tenantId ? cache.delete(tenantId) : cache.clear());

export async function ruleFor(tenantId: string, tool: ToolDef): Promise<ToolRule> {
  const row = (await tenantRows(tenantId)).get(tool.id);
  // A tool missing from the database is unknown to the organisation: it does not run.
  return { name: tool.id, permission: tool.permission, risk: tool.risk, policy: row?.policy ?? "deny", enabled: row?.enabled ?? false };
}

export async function resolveTool(tenantId: string, toolId: string): Promise<{ tool: ToolDef; rule: ToolRule } | null> {
  const builtin = getTool(toolId);
  if (builtin) return { tool: builtin, rule: await ruleFor(tenantId, builtin) };
  const mcp = await resolveMcpTool(tenantId, toolId);
  if (!mcp) return null;
  return { tool: mcp.tool, rule: { name: mcp.tool.id, permission: mcp.tool.permission, risk: mcp.tool.risk, ...mcp.rule } };
}

export async function decide(
  actor: Pick<Actor, "id" | "tenantId" | "permissions">, toolId: string, worker?: WorkerPolicy, opts?: { approved?: boolean },
): Promise<{ tool: ToolDef; decision: Decision } | null> {
  const r = await resolveTool(actor.tenantId, toolId);
  if (!r) return null;
  return { tool: r.tool, decision: authorize({ kind: "user", id: actor.id, permissions: actor.permissions }, r.rule, worker, opts) };
}

/** The tools this person may be offered this turn, and the Open WebUI modules that carry them. */
export async function toolsFor(actor: Actor, worker?: WorkerPolicy): Promise<{ toolIds: string[]; modules: string[] }> {
  const toolIds: string[] = [];
  for (const t of allTools()) {
    if (t.id === "mcp.list") continue; // offered only if the person can use at least one connected tool (below)
    const d = await decide(actor, t.id, worker);
    if (d && d.decision.decision !== "DENY") toolIds.push(t.id);
  }
  let anyMcp = false;
  for (const m of await enabledMcpTools(actor.tenantId)) {
    const tool = buildMcpTool(m.server, m);
    const d = await decide(actor, tool.id, worker);
    if (d && d.decision.decision !== "DENY") { toolIds.push(tool.id); anyMcp = true; }
  }
  if (anyMcp && (!worker?.allow || worker.allow.includes("mcp.list"))) toolIds.push("mcp.list");
  const modules = [...new Set(toolIds.map((id) => (id.startsWith("mcp.") ? "digi_mcp" : getTool(id)!.owuiToolId)))];
  return { toolIds, modules };
}

/** What the model may call through the MCP proxy for this person: name, description and input schema only. */
export async function mcpCatalogFor(actor: Actor) {
  const out: { tool: string; description: string; risk: string; input_schema: Record<string, unknown> }[] = [];
  for (const m of await enabledMcpTools(actor.tenantId)) {
    const id = mcpToolId(m.server, m.name);
    const d = await decide(actor, id);
    if (d && d.decision.decision !== "DENY") out.push({ tool: id, description: m.description, risk: m.risk, input_schema: m.input_schema });
  }
  return out;
}
