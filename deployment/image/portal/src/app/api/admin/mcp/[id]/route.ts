import { McpAdminError, refreshServer, removeServer, setServerEnabled, setTool } from "@/lib/mcp/registry";
import { P } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";

const fail = (error: string, status: number) => Response.json({ error }, { status });
const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Manage one tool server. Body: { action: "refresh" } | { action: "enable" | "disable" } |
 * { action: "tool", tool, enabled?, risk?, permission?, policy? }.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requirePermission(P.mcpManage);
  if (!admin) return fail("You do not have permission to manage tool connections.", 403);
  const id = (await ctx.params).id;
  if (!UUID.test(id)) return fail("That tool server does not exist.", 404);
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    if (b.action === "refresh") return Response.json({ server: await refreshServer(admin, id) });
    if (b.action === "enable" || b.action === "disable") { await setServerEnabled(admin, id, b.action === "enable"); return Response.json({ ok: true }); }
    if (b.action === "tool" && typeof b.tool === "string") {
      await setTool(admin, id, b.tool, {
        enabled: typeof b.enabled === "boolean" ? b.enabled : undefined, risk: typeof b.risk === "string" ? b.risk : undefined,
        permission: b.permission === null ? null : typeof b.permission === "string" ? b.permission : undefined, policy: typeof b.policy === "string" ? b.policy : undefined,
      });
      return Response.json({ ok: true });
    }
    return fail("Unknown action.", 400);
  } catch (e) {
    if (e instanceof McpAdminError) return fail(e.message, e.status);
    console.error("managing a tool server failed", e);
    return fail("That did not work.", 502);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requirePermission(P.mcpManage);
  if (!admin) return fail("You do not have permission to manage tool connections.", 403);
  const id = (await ctx.params).id;
  if (!UUID.test(id)) return fail("That tool server does not exist.", 404);
  try { await removeServer(admin, id); return Response.json({ ok: true }); }
  catch (e) { if (e instanceof McpAdminError) return fail(e.message, e.status); throw e; }
}
