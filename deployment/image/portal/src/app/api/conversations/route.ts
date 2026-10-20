import { conversationStore } from "@/lib/conversations";
import { P } from "@/lib/permissions";
import { can, getSessionUser } from "@/lib/session";

const fail = (error: string, status: number) => Response.json({ error }, { status });

/** The signed-in person's conversations, newest first. Never anyone else's. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return fail("Please sign in again.", 401);
  return Response.json({ chats: await conversationStore().list({ id: user.id, tenantId: user.tenantId }) });
}

/** Starts a conversation with an agent, optionally with a first prompt the chat sends when it opens. */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return fail("Please sign in again.", 401);
  if (!can(user, P.chatUse)) return fail("You do not have access to chat with Digi.", 403);
  let b: { agentId?: unknown; prompt?: unknown };
  try { b = await req.json(); } catch { return fail("Invalid request.", 400); }
  if (typeof b.agentId !== "string" || !b.agentId || b.agentId.length > 200) return fail("Invalid request.", 400);
  const prompt = typeof b.prompt === "string" && b.prompt.trim() ? b.prompt.slice(0, 4000) : undefined;
  const chat = await conversationStore().create({ id: user.id, tenantId: user.tenantId }, { agentId: b.agentId, pendingPrompt: prompt });
  return Response.json({ id: chat.id });
}
