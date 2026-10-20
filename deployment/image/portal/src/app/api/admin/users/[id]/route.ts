import { ACTION_PERMISSION, updateUser } from "@/lib/admin-users";
import { requirePermission } from "@/lib/session";

const fail = (error: string, status: number) => Response.json({ error }, { status });

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let b: { action?: unknown; role?: unknown };
  try { b = await req.json(); } catch { return fail("Invalid request.", 400); }
  if (typeof b.action !== "string" || !(b.action in ACTION_PERMISSION)) return fail("Invalid request.", 400);
  const user = await requirePermission(ACTION_PERMISSION[b.action as keyof typeof ACTION_PERMISSION]);
  if (!user) return fail("Not allowed.", 403);
  const out = await updateUser(user, id, { action: b.action, role: typeof b.role === "string" ? b.role : undefined });
  if ("error" in out) return fail(out.error, out.status ?? 400);
  return Response.json(out);
}
