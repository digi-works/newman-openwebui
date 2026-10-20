import { deleteMemory } from "@/lib/memory";
import { P } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";

/** Deletes one of the person's own notes. Someone else's note behaves as if it does not exist. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requirePermission(P.chatUse);
  if (!user) return Response.json({ error: "Please sign in again." }, { status: 401 });
  const ok = await deleteMemory(user.tenantId, user.id, (await ctx.params).id);
  return ok ? Response.json({ ok: true }) : Response.json({ error: "Not found." }, { status: 404 });
}
