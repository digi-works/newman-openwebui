import { createUser, listUsers } from "@/lib/admin-users";
import { P } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";

const fail = (error: string, status: number) => Response.json({ error }, { status });

export async function GET() {
  const user = await requirePermission(P.usersView);
  if (!user) return fail("Not allowed.", 403);
  return Response.json({ users: await listUsers(user.tenantId) });
}

export async function POST(req: Request) {
  const user = await requirePermission(P.usersCreate);
  if (!user) return fail("Not allowed.", 403);
  let b: { name?: unknown; email?: unknown; role?: unknown };
  try { b = await req.json(); } catch { return fail("Invalid request.", 400); }
  if (typeof b.name !== "string" || typeof b.email !== "string" || typeof b.role !== "string") return fail("Invalid request.", 400);
  const out = await createUser(user, { name: b.name, email: b.email, role: b.role });
  if ("error" in out) return fail(out.error, out.status ?? 400);
  return Response.json(out);
}
