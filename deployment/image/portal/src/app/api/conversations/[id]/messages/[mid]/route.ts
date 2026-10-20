import { conversationStore } from "@/lib/conversations";
import { getSessionUser } from "@/lib/session";

const fail = (error: string, status: number) => Response.json({ error }, { status });

/** Thumbs up or down on an answer. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; mid: string }> }) {
  const user = await getSessionUser();
  if (!user) return fail("Please sign in again.", 401);
  let b: { feedback?: unknown };
  try { b = await req.json(); } catch { return fail("Invalid request.", 400); }
  if (b.feedback !== "up" && b.feedback !== "down" && b.feedback !== null) return fail("Invalid request.", 400);
  const { id, mid } = await ctx.params;
  const ok = await conversationStore().setFeedback({ id: user.id, tenantId: user.tenantId }, id, mid, b.feedback);
  return ok ? Response.json({ ok: true }) : fail("Message not found.", 404);
}
