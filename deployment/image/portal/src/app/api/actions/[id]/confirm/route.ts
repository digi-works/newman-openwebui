import { confirmAction } from "@/lib/pending-actions";
import { getSessionUser } from "@/lib/session";

/** The person presses Confirm on a card Digi prepared. Only the owner's signed-in session can do this, and it commits at most once. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || user.mustChangePassword) return Response.json({ error: "Please sign in again." }, { status: 401 });
  const out = await confirmAction({ id: user.id, tenantId: user.tenantId, name: user.name, email: user.email, permissions: user.permissions }, (await ctx.params).id);
  return Response.json({ action: out.action, error: out.error }, { status: out.status });
}
