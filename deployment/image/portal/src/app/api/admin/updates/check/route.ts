import { P } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { checkForUpdates } from "@/lib/stack/installer";

/** Asks the platform for anything new now (it also happens by itself every hour). */
export async function POST() {
  const admin = await requirePermission(P.aiManage);
  if (!admin) return Response.json({ error: "You do not have permission to manage AI updates." }, { status: 403 });
  return Response.json(await checkForUpdates());
}
