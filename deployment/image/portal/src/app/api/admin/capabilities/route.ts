import { P } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { setAppCapability } from "@/lib/stack/admin";

/** Switches an AI capability on or off for one App: { capability, app, enabled }. Roles are set on Settings > Permissions. */
export async function PUT(req: Request) {
  const admin = await requirePermission(P.aiManage);
  if (!admin) return Response.json({ error: "You do not have permission to manage AI capabilities." }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { capability?: unknown; app?: unknown; enabled?: unknown };
  if (typeof b.capability !== "string" || typeof b.app !== "string" || typeof b.enabled !== "boolean") return Response.json({ error: "Send { capability, app, enabled }." }, { status: 400 });
  return (await setAppCapability(admin, b.app, b.capability, b.enabled)) ? Response.json({ ok: true }) : Response.json({ error: "Not found." }, { status: 404 });
}
