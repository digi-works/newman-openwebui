import { redirect } from "next/navigation";
import { P } from "@/lib/permissions";
import { can, getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Settings opens on the first page the signed-in person can use. */
export default async function SettingsIndex() {
  const user = await getSessionUser();
  redirect(can(user, P.usersView) ? "/settings/users" : can(user, P.rolesManage) ? "/settings/permissions" : can(user, P.aiManage) ? "/settings/ai" : "/settings/account");
}
