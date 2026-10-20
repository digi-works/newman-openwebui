import { HistoryList } from "@/components/history-list";
import { listAgents } from "@/lib/api";

export default async function HistoryPage() {
  return (
    <div className="p-4 md:p-8">
      <HistoryList agents={await listAgents()} />
    </div>
  );
}
