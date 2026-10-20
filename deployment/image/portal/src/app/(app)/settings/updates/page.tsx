import { redirect } from "next/navigation";
import { UpdatesAdmin } from "@/components/updates-admin";
import { P } from "@/lib/permissions";
import { authLive, requirePermission } from "@/lib/session";
import { updatesView } from "@/lib/stack/admin";

export const dynamic = "force-dynamic";

export default async function UpdatesPage() {
  const viewer = await requirePermission(P.aiManage);
  if (!viewer) redirect("/settings");
  const view = authLive() ? await updatesView(viewer.tenantId) : null;
  return (
    <div className="p-4 md:p-8">
      <UpdatesAdmin initial={view} />
    </div>
  );
}
