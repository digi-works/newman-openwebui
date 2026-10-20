import { AiConnectionError, applyToRuntime } from "@/lib/ai-connection";
import { P } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";

/** Puts the saved key into the AI runtime's matching connection. { dryRun: true } only reports what would change. */
export async function POST(req: Request) {
  const admin = await requirePermission(P.aiManage);
  if (!admin) return Response.json({ error: "You do not have permission to manage the AI connection." }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { dryRun?: unknown };
  try {
    return Response.json(await applyToRuntime(admin, b.dryRun !== false));
  } catch (e) {
    if (e instanceof AiConnectionError) return Response.json({ error: e.message }, { status: e.status });
    console.error("applying the AI key failed", e);
    return Response.json({ error: "Could not apply the key." }, { status: 502 });
  }
}
