import { ReleasesView } from "@/components/platform/releases-view";
import { currentOperator } from "@/lib/studio/auth";
import { sq } from "@/lib/studio/db";
import { listReleases } from "@/lib/studio/releases";
import { signerAvailable } from "@/lib/studio/signer";

export const dynamic = "force-dynamic";

export default async function ReleasesPage() {
  const op = await currentOperator();
  const published = await sq<{ worker_id: string; version: number; name: string }>(
    "select v.worker_id, v.version, w.name from studio_worker_versions v join studio_workers w on w.id = v.worker_id where v.status = 'published' order by w.name, v.version desc");
  return <ReleasesView releases={(await listReleases()).map((r) => ({ ...r, signed_at: new Date(r.signed_at).toISOString() }))} published={published} signerReady={signerAvailable()} isAdmin={op?.role === "platform_admin"} />;
}
