import { P } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { rollback } from "@/lib/stack/installer";

/** Goes back to the previous release. It moves the active pointer; nothing is rebuilt from the platform. */
export async function POST() {
  const admin = await requirePermission(P.aiManage);
  if (!admin) return Response.json({ error: "You do not have permission to manage AI updates." }, { status: 403 });
  const r = await rollback(admin.id);
  return r.ok ? Response.json(r) : Response.json({ error: r.reason }, { status: 409 });
}
