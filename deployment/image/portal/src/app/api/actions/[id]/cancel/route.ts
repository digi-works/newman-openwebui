import { cancelAction } from "@/lib/pending-actions";
import { getSessionUser } from "@/lib/session";

/** The person decides not to go ahead with a prepared action. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || user.mustChangePassword) return Response.json({ error: "Please sign in again." }, { status: 401 });
  const action = await cancelAction({ id: user.id, tenantId: user.tenantId, name: user.name, email: user.email, permissions: user.permissions }, (await ctx.params).id);
  if (!action) return Response.json({ error: "That action no longer exists." }, { status: 404 });
  return Response.json({ action });
}
