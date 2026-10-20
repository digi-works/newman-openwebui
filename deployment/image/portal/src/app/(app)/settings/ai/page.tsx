import { redirect } from "next/navigation";
import { RuntimeAdmin } from "@/components/runtime-admin";
import { runtimeView } from "@/lib/stack/runtime-switch";
import { AiConnectionAdmin } from "@/components/ai-connection-admin";
import { aiStatus } from "@/lib/ai-connection";
import { memoryEnabled } from "@/lib/memory";
import { P } from "@/lib/permissions";
import { secretsEnabled } from "@/lib/secrets";
import { authLive, requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AiConnectionPage() {
  const viewer = await requirePermission(P.aiManage);
  if (!viewer) redirect("/settings");
  const status = authLive() ? await aiStatus(viewer.tenantId) : null;
  return (
    <div className="p-4 md:p-8">
      {authLive() && <div className="mx-auto mb-6 w-full max-w-2xl"><RuntimeAdmin initial={await runtimeView()} /></div>}
      <AiConnectionAdmin initial={status} secretsReady={secretsEnabled()} memoryOn={authLive() ? await memoryEnabled(viewer.tenantId) : true} />
    </div>
  );
}
