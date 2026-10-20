import { addMemory, listMemories, MemoryError, memoryEnabled } from "@/lib/memory";
import { P } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";

const fail = (error: string, status: number) => Response.json({ error }, { status });

/** The signed-in person's own notes. Nobody else's are ever returned. */
export async function GET() {
  const user = await requirePermission(P.chatUse);
  if (!user) return fail("Please sign in again.", 401);
  return Response.json({ enabled: await memoryEnabled(user.tenantId), items: await listMemories(user.tenantId, user.id) });
}

/** Adds a note the person wrote themselves. */
export async function POST(req: Request) {
  const user = await requirePermission(P.chatUse);
  if (!user) return fail("Please sign in again.", 401);
  const b = (await req.json().catch(() => ({}))) as { text?: unknown };
  if (typeof b.text !== "string") return fail("Say what to remember.", 400);
  try {
    return Response.json({ item: await addMemory(user.tenantId, user.id, b.text) });
  } catch (e) {
    if (e instanceof MemoryError) return fail(e.message, e.status);
    throw e;
  }
}
