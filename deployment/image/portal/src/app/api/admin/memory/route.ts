import { memoryEnabled, setMemoryEnabled } from "@/lib/memory";
import { P } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";

/** Whether the organisation lets Digi keep notes. */
export async function GET() {
  const admin = await requirePermission(P.aiManage);
  if (!admin) return Response.json({ error: "You do not have permission to change this." }, { status: 403 });
  return Response.json({ enabled: await memoryEnabled(admin.tenantId) });
}

export async function PUT(req: Request) {
  const admin = await requirePermission(P.aiManage);
  if (!admin) return Response.json({ error: "You do not have permission to change this." }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { enabled?: unknown };
  if (typeof b.enabled !== "boolean") return Response.json({ error: "Say whether memory is on or off." }, { status: 400 });
  await setMemoryEnabled(admin, b.enabled);
  return Response.json({ enabled: b.enabled });
}
