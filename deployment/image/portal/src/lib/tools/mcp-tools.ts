import type { Actor } from "../booking-service";
import { callMcp, enabledMcpTools, loadMcpTool } from "../mcp/registry";
import type { PermissionCode } from "../permissions";
import type { Args, ToolDef } from "./registry";

/** MCP tools as Digi tools: the same contract as the built-in ones, built from a registry row, so Authority treats them identically. */
export const mcpToolId = (server: string, tool: string) => `mcp.${server}.${tool}`;
export const parseMcpToolId = (id: string): { server: string; tool: string } | null => {
  const m = /^mcp\.([a-z0-9][a-z0-9_-]{1,40})\.([\w.-]{1,64})$/.exec(id);
  return m ? { server: m[1], tool: m[2] } : null;
};

const brief = (args: Args) => {
  const s = JSON.stringify(args);
  return s.length > 200 ? s.slice(0, 200) + "…" : s;
};

export function buildMcpTool(
  server: string, row: { name: string; description: string; risk: "read" | "write" | "high_impact"; permission: string | null },
): ToolDef {
  const call = async (actor: Actor, args: Args) => ({ result: await callMcp(actor.tenantId, server, row.name, args) });
  const base = { id: mcpToolId(server, row.name), description: row.description || row.name, risk: row.risk, permission: (row.permission ?? "") as PermissionCode, owuiToolId: "digi_mcp" };
  if (row.risk === "read") return { ...base, run: call };
  return {
    ...base,
    async prepare(_actor, args) { return { summary: `Run ${row.name} on ${server} with ${brief(args)}`, args }; },
    commit: call,
  };
}

export async function resolveMcpTool(tenantId: string, id: string) {
  const p = parseMcpToolId(id);
  if (!p) return null;
  const row = await loadMcpTool(tenantId, p.server, p.tool);
  if (!row) return null;
  return {
    tool: buildMcpTool(p.server, row),
    rule: { enabled: !!(row.server_enabled && row.enabled), policy: row.policy as "allow" | "ask" | "deny" },
  };
}

export { enabledMcpTools };
