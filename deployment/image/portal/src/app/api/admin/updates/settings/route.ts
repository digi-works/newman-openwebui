import { P } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { StackError } from "@/lib/stack/identity";
import { setUpdateSettings } from "@/lib/stack/installer";

/** { mode: approval | auto | pin, channel: stable | preview }. Approval is the default. */
export async function PUT(req: Request) {
  const admin = await requirePermission(P.aiManage);
  if (!admin) return Response.json({ error: "You do not have permission to manage AI updates." }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { mode?: unknown; channel?: unknown };
  try {
    await setUpdateSettings({ mode: typeof b.mode === "string" ? b.mode : undefined, channel: typeof b.channel === "string" ? b.channel : undefined });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof StackError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
