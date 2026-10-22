import { conversationStore } from "@/lib/conversations";
import { stopTurn } from "@/lib/live-turns";
import { getSessionUser } from "@/lib/session";

const fail = (error: string, status: number) => Response.json({ error }, { status });

/**
 * Stop an answer. The saved answer is cut to what the person saw (`shown` characters) and marked stopped, so a reload or History never shows
 * more than was delivered. If the turn already ended (it finished while the browser was still reading), the saved message is cut the same way.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string; mid: string }> }) {
  const user = await getSessionUser();
  if (!user) return fail("Please sign in again.", 401);
  let b: { shown?: unknown };
  try { b = await req.json(); } catch { return fail("Invalid request.", 400); }
  const shown = Number(b.shown);
  if (!Number.isInteger(shown) || shown < 0) return fail("Invalid request.", 400);
  const { id, mid } = await ctx.params;
  if ((await stopTurn(mid, user.id, shown)) === "stopped") return Response.json({ ok: true });

  const owner = { id: user.id, tenantId: user.tenantId };
  const store = conversationStore();
  const msg = (await store.get(owner, id))?.messages.find((m) => m.id === mid && m.role === "assistant");
  if (!msg) return fail("Message not found.", 404);
  if (msg.status === "error") return Response.json({ ok: true });
  await store.updateMessage(owner, id, mid, { content: msg.text.slice(0, shown), status: "stopped" });
  return Response.json({ ok: true });
}
