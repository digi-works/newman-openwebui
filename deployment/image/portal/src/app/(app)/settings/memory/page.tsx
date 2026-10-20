import { MemoryView } from "@/components/memory-view";
import { listMemories, memoryEnabled } from "@/lib/memory";
import { authLive, getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function MemoryPage() {
  const user = await getSessionUser();
  const live = authLive() && !!user;
  const [enabled, items] = live ? await Promise.all([memoryEnabled(user!.tenantId), listMemories(user!.tenantId, user!.id)]) : [true, []];
  return (
    <div className="p-4 md:p-8">
      <MemoryView initialItems={items} enabled={enabled} />
    </div>
  );
}
