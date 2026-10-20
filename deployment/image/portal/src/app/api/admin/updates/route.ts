import { P } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { updatesView } from "@/lib/stack/admin";

/** AI updates and capabilities for the customer Admin. */
export async function GET() {
  const admin = await requirePermission(P.aiManage);
  if (!admin) return Response.json({ error: "You do not have permission to manage AI updates." }, { status: 403 });
  return Response.json(await updatesView(admin.tenantId));
}
