import { InstallationsView } from "@/components/platform/installations-view";
import { currentOperator } from "@/lib/studio/auth";
import { listInstallations, listTokens } from "@/lib/studio/installations";

export const dynamic = "force-dynamic";

export default async function InstallationsPage() {
  const op = await currentOperator();
  const isAdmin = op?.role === "platform_admin";
  return (
    <InstallationsView
      isAdmin={isAdmin}
      installations={(await listInstallations()).map((i) => ({ ...i, enrolled_at: new Date(i.enrolled_at).toISOString(), last_pull_at: i.last_pull_at ? new Date(i.last_pull_at).toISOString() : null }))}
      tokens={isAdmin ? (await listTokens()).map((t) => ({ ...t, expires_at: new Date(t.expires_at).toISOString(), used_at: t.used_at ? new Date(t.used_at).toISOString() : null })) : []}
    />
  );
}
