import { P } from "@/lib/permissions";
import { getRuntime } from "@/lib/runtime";
import { requirePermission } from "@/lib/session";
import { enrollStack, StackError } from "@/lib/stack/identity";

/** Connects this stack to the platform release service with a single-use enrollment token the platform gave you: { url, token }. */
export async function POST(req: Request) {
  const admin = await requirePermission(P.aiManage);
  if (!admin) return Response.json({ error: "You do not have permission to manage AI updates." }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { url?: unknown; token?: unknown };
  if (typeof b.url !== "string" || typeof b.token !== "string" || !b.token.trim()) return Response.json({ error: "Enter the release address and the enrollment token." }, { status: 400 });
  try {
    const r = await enrollStack(b.url.trim(), b.token.trim(), (await getRuntime()).capabilities().capabilities as unknown as Record<string, boolean>);
    return Response.json({ ok: true, installationId: r.installationId });
  } catch (e) {
    if (e instanceof StackError) return Response.json({ error: e.message }, { status: e.status });
    console.error("enrolment failed", e);
    return Response.json({ error: "Could not enrol this stack." }, { status: 502 });
  }
}
