import { WorkersGallery } from "@/components/workers-gallery";
import { listAgents } from "@/lib/api";

export default async function WorkersPage() {
  return (
    <div className="p-4 md:p-8">
      <WorkersGallery agents={await listAgents()} />
    </div>
  );
}
