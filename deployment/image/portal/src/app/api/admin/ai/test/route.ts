import { AiConnectionError, aiStatus, testConnection } from "@/lib/ai-connection";
import { P } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";

/** Tests the saved key against the provider. { deep: true } also makes one tiny request to read the rate limits. */
export async function POST(req: Request) {
  const admin = await requirePermission(P.aiManage);
  if (!admin) return Response.json({ error: "You do not have permission to manage the AI connection." }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { deep?: unknown };
  try {
    const result = await testConnection(admin, b.deep === true);
    return Response.json({ result, status: await aiStatus(admin.tenantId) });
  } catch (e) {
    if (e instanceof AiConnectionError) return Response.json({ error: e.message }, { status: e.status });
    console.error("testing the AI key failed", e);
    return Response.json({ error: "Could not test the key." }, { status: 502 });
  }
}
