import { redirect } from "next/navigation";
import { UsersAdmin } from "@/components/users-admin";
import { listRoleOptions, listUsers } from "@/lib/admin-users";
import { P } from "@/lib/permissions";
import { authLive, requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const viewer = await requirePermission(P.usersView);
  if (!viewer) redirect("/settings");
  const [users, roles] = authLive() ? await Promise.all([listUsers(viewer.tenantId), listRoleOptions(viewer.tenantId)]) : [[], []];
  const all = viewer.permissions.includes("*");
  return (
    <div className="p-4 md:p-8">
      <UsersAdmin
        users={users}
        roles={roles}
        selfId={viewer.id}
        can={{
          create: all || viewer.permissions.includes(P.usersCreate),
          update: all || viewer.permissions.includes(P.usersUpdate),
          disable: all || viewer.permissions.includes(P.usersDisable),
          giveAdmin: all,
        }}
      />
    </div>
  );
}
