import { WorkersHome } from "@/components/platform/workers-home";
import { listWorkers } from "@/lib/studio/store";

export const dynamic = "force-dynamic";

export default async function PlatformHome() {
  return <WorkersHome initial={await listWorkers()} />;
}
