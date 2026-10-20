import { redirect } from "next/navigation";
import { currentOperator } from "@/lib/studio/auth";
import { sq } from "@/lib/studio/db";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const op = await currentOperator();
  if (op?.role !== "platform_admin") redirect("/platform");
  const rows = await sq<{ id: string; actor: string; action: string; entity_type: string | null; entity_id: string | null; result: string; created_at: string }>(
    "select id, actor, action, entity_type, entity_id, result, created_at from studio_audit_events order by id desc limit 200");
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Audit</h1>
      <div className="overflow-x-auto rounded-2xl border bg-card">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground"><tr><th className="px-4 py-2">When</th><th>Action</th><th>Entity</th><th>Result</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id} className="border-t"><td className="px-4 py-1.5 text-muted-foreground">{new Date(r.created_at).toLocaleString()}</td><td className="font-mono text-xs">{r.action}</td><td className="font-mono text-xs">{r.entity_id ?? ""}</td><td className={r.result === "success" ? "" : "text-destructive"}>{r.result}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
