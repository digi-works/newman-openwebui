import { McpAdminError, listServers, registerServer } from "@/lib/mcp/registry";
import { P } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";

const fail = (error: string, status: number) => Response.json({ error }, { status });

/** The registered tool servers and their tools. Credentials are never returned. */
export async function GET() {
  const admin = await requirePermission(P.mcpManage);
  if (!admin) return fail("You do not have permission to manage tool connections.", 403);
  return Response.json({ servers: await listServers(admin.tenantId) });
}

/** Registers a tool server: { name, url, credential? }. It starts switched off; refresh it to discover its tools. */
export async function POST(req: Request) {
  const admin = await requirePermission(P.mcpManage);
  if (!admin) return fail("You do not have permission to manage tool connections.", 403);
  const b = (await req.json().catch(() => ({}))) as { name?: unknown; url?: unknown; credential?: unknown };
  if (typeof b.name !== "string" || typeof b.url !== "string") return fail("Give the server a name and an address.", 400);
  try {
    const id = await registerServer(admin, { name: b.name, url: b.url, credential: typeof b.credential === "string" ? b.credential : undefined });
    return Response.json({ id });
  } catch (e) {
    if (e instanceof McpAdminError) return fail(e.message, e.status);
    console.error("registering a tool server failed", e);
    return fail("Could not register the tool server.", 502);
  }
}
