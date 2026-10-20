import { conversationStore } from "@/lib/conversations";
import { getSessionUser } from "@/lib/session";

const fail = (error: string, status: number) => Response.json({ error }, { status });
type Ctx = { params: Promise<{ id: string }> };

/** Someone else's conversation, or one that does not exist, both answer 404. */
export async function GET(_req: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) return fail("Please sign in again.", 401);
  const chat = await conversationStore().get({ id: user.id, tenantId: user.tenantId }, (await ctx.params).id);
  return chat ? Response.json({ chat }) : fail("Conversation not found.", 404);
}

export async function PATCH(req: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) return fail("Please sign in again.", 401);
  let b: { title?: unknown; clearPending?: unknown };
  try { b = await req.json(); } catch { return fail("Invalid request.", 400); }
  const ok = await conversationStore().patch({ id: user.id, tenantId: user.tenantId }, (await ctx.params).id, {
    title: typeof b.title === "string" && b.title.trim() ? b.title.trim() : undefined,
    clearPending: b.clearPending === true,
  });
  return ok ? Response.json({ ok: true }) : fail("Conversation not found.", 404);
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) return fail("Please sign in again.", 401);
  const ok = await conversationStore().remove({ id: user.id, tenantId: user.tenantId }, (await ctx.params).id);
  return ok ? Response.json({ ok: true }) : fail("Conversation not found.", 404);
}
