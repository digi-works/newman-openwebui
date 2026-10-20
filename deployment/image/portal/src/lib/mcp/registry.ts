import { createHash } from "node:crypto";
import { auditEvent } from "../audit";
import { withTenant } from "../digi-db";
import { P } from "../permissions";
import { putSecret, readSecret } from "../secrets";
import { connect, McpError } from "./client";

/**
 * The MCP proxy registry (M5.9). A tenant registers a tool server once (its credential is stored as a secret and only referenced here),
 * Digi discovers its tools, and an admin switches individual tools on and gives each a permission, a risk and a policy. A newly discovered
 * tool is off, has no permission, and would ask for approval. If a server's tool changes its definition, that tool is switched off again until
 * an admin looks at it. Every call then goes through the Tool Gateway and the Authority engine like any other tool.
 */
export type McpToolRow = {
  name: string; description: string; inputSchema: Record<string, unknown>; enabled: boolean; risk: "read" | "write" | "high_impact";
  permission: string | null; policy: "allow" | "ask" | "deny"; changed?: boolean;
};
export type McpServerRow = {
  id: string; name: string; url: string; hasCredential: boolean; enabled: boolean; status: string; lastChecked: string | null; lastError: string | null;
  schemaHash: string | null; tools: McpToolRow[];
};

const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const stableHash = (name: string, schema: Record<string, unknown>) => hash([name, Object.keys(schema).sort().map((k) => [k, schema[k]])]);
const PERMISSIONS = new Set<string>(Object.values(P));
export class McpAdminError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

type Admin = { id: string; tenantId: string };

export async function listServers(tenantId: string): Promise<McpServerRow[]> {
  return withTenant(tenantId, async (c) => {
    const servers = (await c.query("select * from mcp_servers order by name")).rows;
    const tools = (await c.query("select * from mcp_tools order by name")).rows;
    return servers.map((s): McpServerRow => ({
      id: s.id, name: s.name, url: s.url, hasCredential: !!s.secret_name, enabled: s.enabled, status: s.status,
      lastChecked: s.last_checked ? new Date(s.last_checked).toISOString() : null, lastError: s.last_error, schemaHash: s.schema_hash,
      tools: tools.filter((t) => t.server_id === s.id).map((t) => ({
        name: t.name, description: t.description, inputSchema: t.input_schema, enabled: t.enabled, risk: t.risk, permission: t.permission, policy: t.policy,
      })),
    }));
  });
}

export async function registerServer(admin: Admin, input: { name: string; url: string; credential?: string }) {
  const name = input.name.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,40}$/.test(name)) throw new McpAdminError("Use a short lowercase name with letters, numbers, dash or underscore.");
  try { await (await import("./client")).assertMcpUrl(input.url); } catch (e) { throw new McpAdminError((e as Error).message); }
  const credential = input.credential?.trim();
  const secretName = credential ? `mcp:${name}` : null;
  if (credential) await putSecret(admin.tenantId, secretName!, credential, admin.id, { for: "mcp", server: name });
  return withTenant(admin.tenantId, async (c) => {
    try {
      const { rows } = await c.query("insert into mcp_servers (tenant_id, name, url, secret_name) values ($1, $2, $3, $4) returning id", [admin.tenantId, name, input.url.trim(), secretName]);
      await auditEvent(c, { tenantId: admin.tenantId, userId: admin.id, action: "mcp.server.register", entityType: "mcp_server", entityId: rows[0].id, metadata: { name, url: input.url.trim() } });
      return rows[0].id as string;
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new McpAdminError("A tool server with that name already exists.");
      throw e;
    }
  });
}

/** Connects, reads the tool list, records health and a schema hash. New tools arrive off; a tool whose definition changed is switched off. */
export async function refreshServer(admin: Admin, serverId: string): Promise<McpServerRow> {
  const srv = await withTenant(admin.tenantId, async (c) => (await c.query("select * from mcp_servers where id = $1", [serverId])).rows[0]);
  if (!srv) throw new McpAdminError("That tool server does not exist.", 404);
  const token = srv.secret_name ? await readSecret(admin.tenantId, srv.secret_name) : null;
  let discovered: Awaited<ReturnType<Awaited<ReturnType<typeof connect>>["listTools"]>> = [];
  let failure: string | null = null;
  try { discovered = await (await connect(srv.url, token)).listTools(); } catch (e) { failure = e instanceof McpError ? e.message : "Could not read the tool server."; }

  await withTenant(admin.tenantId, async (c) => {
    if (failure) {
      await c.query("update mcp_servers set status = 'unreachable', last_checked = now(), last_error = $2 where id = $1", [serverId, failure]);
      return;
    }
    const existing = new Map((await c.query("select name, schema_hash from mcp_tools where server_id = $1", [serverId])).rows.map((r) => [r.name as string, r.schema_hash as string]));
    const changed: string[] = [];
    for (const t of discovered.slice(0, 200)) {
      const h = stableHash(t.name, t.inputSchema);
      if (!existing.has(t.name)) {
        await c.query("insert into mcp_tools (tenant_id, server_id, name, description, input_schema, schema_hash) values ($1, $2, $3, $4, $5, $6)", [admin.tenantId, serverId, t.name, t.description, JSON.stringify(t.inputSchema), h]);
      } else if (existing.get(t.name) !== h) {
        changed.push(t.name);
        await c.query("update mcp_tools set description = $3, input_schema = $4, schema_hash = $5, enabled = false, discovered_at = now() where server_id = $1 and name = $2", [serverId, t.name, t.description, JSON.stringify(t.inputSchema), h]);
      } else {
        await c.query("update mcp_tools set description = $3 where server_id = $1 and name = $2", [serverId, t.name, t.description]);
      }
    }
    const serverHash = hash(discovered.map((t) => stableHash(t.name, t.inputSchema)).sort());
    await c.query("update mcp_servers set status = 'healthy', last_checked = now(), last_error = $2, schema_hash = $3 where id = $1", [serverId, changed.length ? `These tools changed and were switched off until reviewed: ${changed.join(", ")}.` : null, serverHash]);
    await auditEvent(c, { tenantId: admin.tenantId, userId: admin.id, action: "mcp.server.refresh", entityType: "mcp_server", entityId: serverId, metadata: { tools: discovered.length, changed } });
  });
  return (await listServers(admin.tenantId)).find((s) => s.id === serverId)!;
}

export async function setServerEnabled(admin: Admin, serverId: string, enabled: boolean) {
  await withTenant(admin.tenantId, async (c) => {
    const r = await c.query("update mcp_servers set enabled = $2 where id = $1", [serverId, enabled]);
    if (!r.rowCount) throw new McpAdminError("That tool server does not exist.", 404);
    await auditEvent(c, { tenantId: admin.tenantId, userId: admin.id, action: enabled ? "mcp.server.enable" : "mcp.server.disable", entityType: "mcp_server", entityId: serverId });
  });
}

export async function setTool(admin: Admin, serverId: string, tool: string, patch: { enabled?: boolean; risk?: string; permission?: string | null; policy?: string }) {
  if (patch.risk !== undefined && !["read", "write", "high_impact"].includes(patch.risk)) throw new McpAdminError("Risk must be read, write or high_impact.");
  if (patch.policy !== undefined && !["allow", "ask", "deny"].includes(patch.policy)) throw new McpAdminError("Policy must be allow, ask or deny.");
  if (patch.permission && !PERMISSIONS.has(patch.permission)) throw new McpAdminError("Choose an existing permission for this tool.");
  await withTenant(admin.tenantId, async (c) => {
    const cur = (await c.query("select permission from mcp_tools where server_id = $1 and name = $2 for update", [serverId, tool])).rows[0];
    if (!cur) throw new McpAdminError("That tool does not exist.", 404);
    const permission = patch.permission === undefined ? cur.permission : patch.permission;
    // a tool without a permission can never be on
    if (patch.enabled === true && !permission) throw new McpAdminError("Give the tool a permission before switching it on.");
    await c.query(
      `update mcp_tools set enabled = coalesce($3, enabled), risk = coalesce($4, risk), permission = $5, policy = coalesce($6, policy) where server_id = $1 and name = $2`,
      [serverId, tool, patch.enabled ?? null, patch.risk ?? null, permission || null, patch.policy ?? null],
    );
    await auditEvent(c, { tenantId: admin.tenantId, userId: admin.id, action: "mcp.tool.update", entityType: "mcp_tool", entityId: `${serverId}:${tool}`, metadata: { enabled: patch.enabled, risk: patch.risk, permission: patch.permission, policy: patch.policy } });
  });
}

export async function removeServer(admin: Admin, serverId: string) {
  await withTenant(admin.tenantId, async (c) => {
    const s = (await c.query("delete from mcp_servers where id = $1 returning name, secret_name", [serverId])).rows[0];
    if (!s) throw new McpAdminError("That tool server does not exist.", 404);
    if (s.secret_name) await c.query("delete from tenant_secrets where name = $1", [s.secret_name]);
    await auditEvent(c, { tenantId: admin.tenantId, userId: admin.id, action: "mcp.server.remove", entityType: "mcp_server", entityId: serverId, metadata: { name: s.name } });
  });
}

/** What the gateway needs to decide and call one tool. Null when the server or tool is unknown. */
export async function loadMcpTool(tenantId: string, server: string, tool: string) {
  return withTenant(tenantId, async (c) => {
    const r = (await c.query(
      `select s.id as server_id, s.url, s.secret_name, s.enabled as server_enabled, t.name, t.description, t.input_schema, t.enabled, t.risk, t.permission, t.policy
         from mcp_servers s join mcp_tools t on t.server_id = s.id where s.name = $1 and t.name = $2`, [server, tool],
    )).rows[0];
    return r ?? null;
  });
}

/** Every enabled tool with a permission, as the gateway sees them (for choosing what a person may be offered). */
export async function enabledMcpTools(tenantId: string) {
  return withTenant(tenantId, async (c) => (await c.query(
    `select s.name as server, t.name, t.description, t.input_schema, t.risk, t.permission, t.policy
       from mcp_servers s join mcp_tools t on t.server_id = s.id where s.enabled and t.enabled and t.permission is not null order by s.name, t.name`,
  )).rows as { server: string; name: string; description: string; input_schema: Record<string, unknown>; risk: "read" | "write" | "high_impact"; permission: string; policy: "allow" | "ask" | "deny" }[]);
}

export async function callMcp(tenantId: string, server: string, tool: string, args: Record<string, unknown>) {
  const row = await loadMcpTool(tenantId, server, tool);
  if (!row || !row.server_enabled || !row.enabled) throw new McpError("That tool is not available.", 404);
  const token = row.secret_name ? await readSecret(tenantId, row.secret_name) : null;
  const out = await (await connect(row.url, token)).callTool(tool, args);
  if (out.isError) throw new McpError(out.text.slice(0, 300) || "The tool reported an error.", 502);
  return out.text;
}
