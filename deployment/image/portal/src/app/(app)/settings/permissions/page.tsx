import { redirect } from "next/navigation";
import { PermissionsAdmin } from "@/components/permissions-admin";
import { listCatalog, listRoles } from "@/lib/admin-roles";
import { P } from "@/lib/permissions";
import { authLive, requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function PermissionsPage() {
  const viewer = await requirePermission(P.rolesManage);
  if (!viewer) redirect("/settings");
  const [roles, catalog] = authLive() ? await Promise.all([listRoles(viewer.tenantId), listCatalog(viewer.tenantId)]) : [[], []];
  return (
    <div className="p-4 md:p-8">
      <PermissionsAdmin roles={roles} catalog={catalog} />
    </div>
  );
}
