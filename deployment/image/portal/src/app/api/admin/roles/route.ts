import { createRole, listCatalog, listRoles } from "@/lib/admin-roles";
import { P } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";

const fail = (error: string, status: number) => Response.json({ error }, { status });

export async function GET() {
  const user = await requirePermission(P.rolesManage);
  if (!user) return fail("Not allowed.", 403);
  return Response.json({ roles: await listRoles(user.tenantId), catalog: await listCatalog(user.tenantId) });
}

export async function POST(req: Request) {
  const user = await requirePermission(P.rolesManage);
  if (!user) return fail("Not allowed.", 403);
  let b: { name?: unknown; description?: unknown };
  try { b = await req.json(); } catch { return fail("Invalid request.", 400); }
  if (typeof b.name !== "string") return fail("Invalid request.", 400);
  const out = await createRole(user, { name: b.name, description: typeof b.description === "string" ? b.description : "" });
  if ("error" in out) return fail(out.error, 400);
  return Response.json(out);
}
