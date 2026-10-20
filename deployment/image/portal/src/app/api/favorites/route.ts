import { conversationStore } from "@/lib/conversations";
import { getSessionUser } from "@/lib/session";

const fail = (error: string, status: number) => Response.json({ error }, { status });

export async function GET() {
  const user = await getSessionUser();
  if (!user) return fail("Please sign in again.", 401);
  return Response.json({ favorites: await conversationStore().favorites({ id: user.id, tenantId: user.tenantId }) });
}

/** Adds the agent to the person's favorites, or removes it if it is already there. */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return fail("Please sign in again.", 401);
  let b: { agentId?: unknown };
  try { b = await req.json(); } catch { return fail("Invalid request.", 400); }
  if (typeof b.agentId !== "string" || !b.agentId || b.agentId.length > 200) return fail("Invalid request.", 400);
  return Response.json({ favorites: await conversationStore().toggleFavorite({ id: user.id, tenantId: user.tenantId }, b.agentId) });
}
