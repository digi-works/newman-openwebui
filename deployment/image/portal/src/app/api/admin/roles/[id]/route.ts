import { deleteRole, saveRole } from "@/lib/admin-roles";
import { P } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";

const fail = (error: string, status: number) => Response.json({ error }, { status });

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requirePermission(P.rolesManage);
  if (!user) return fail("Not allowed.", 403);
  const { id } = await ctx.params;
  let b: { description?: unknown; permissions?: unknown };
  try { b = await req.json(); } catch { return fail("Invalid request.", 400); }
  const permissions = Array.isArray(b.permissions) && b.permissions.every((p) => typeof p === "string") ? (b.permissions as string[]) : undefined;
  const out = await saveRole(user, id, { description: typeof b.description === "string" ? b.description : undefined, permissions });
  if ("error" in out) return fail(out.error, out.status ?? 400);
  return Response.json(out);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requirePermission(P.rolesManage);
  if (!user) return fail("Not allowed.", 403);
  const { id } = await ctx.params;
  const out = await deleteRole(user, id);
  if ("error" in out) return fail(out.error, out.status ?? 400);
  return Response.json(out);
}
