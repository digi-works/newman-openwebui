import { AiConnectionError, aiStatus, saveConnection } from "@/lib/ai-connection";
import { P } from "@/lib/permissions";
import { secretsEnabled } from "@/lib/secrets";
import { requirePermission } from "@/lib/session";

const fail = (error: string, status: number) => Response.json({ error }, { status });

/** The AI connection's state. The key itself is never returned: only whether one exists and its last four characters. */
export async function GET() {
  const admin = await requirePermission(P.aiManage);
  if (!admin) return fail("You do not have permission to manage the AI connection.", 403);
  return Response.json({ status: await aiStatus(admin.tenantId), secretsReady: secretsEnabled() });
}

/** Saves the organisation's AI key (write-only). */
export async function PUT(req: Request) {
  const admin = await requirePermission(P.aiManage);
  if (!admin) return fail("You do not have permission to manage the AI connection.", 403);
  if (!secretsEnabled()) return fail("The server has no secret key configured, so keys cannot be stored safely yet.", 503);
  let b: { apiKey?: unknown; baseUrl?: unknown };
  try { b = await req.json(); } catch { return fail("Invalid request.", 400); }
  if (typeof b.apiKey !== "string") return fail("Paste the API key.", 400);
  try {
    return Response.json({ status: await saveConnection(admin, { apiKey: b.apiKey, baseUrl: typeof b.baseUrl === "string" ? b.baseUrl : undefined }) });
  } catch (e) {
    if (e instanceof AiConnectionError) return fail(e.message, e.status);
    console.error("saving the AI key failed", e);
    return fail("Could not save the key.", 502);
  }
}
