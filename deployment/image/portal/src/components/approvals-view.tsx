"use client";

import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ApprovalRow } from "@/lib/approvals";

/** Actions that wait for another person's decision. You cannot decide your own request. */
export function ApprovalsView({ initial }: { initial: ApprovalRow[] }) {
  const [items, setItems] = useState(initial);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function decide(a: ApprovalRow, decision: "approve" | "decline") {
    setBusy(a.id + decision); setError("");
    const res = await fetch(`/api/approvals/${a.id}/decide`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, reason: reasons[a.id] ?? "" }) }).catch(() => null);
    const out = res ? await res.json().catch(() => ({})) : {};
    setBusy(null);
    if (!res || !res.ok) { setError(out.error ?? "That did not work."); return; }
    setItems((xs) => xs.filter((x) => x.id !== a.id));
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
        <p className="text-sm text-muted-foreground">Actions that need another person to say yes before they happen. You cannot decide your own.</p>
      </div>
      {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {items.length === 0 ? (
        <p className="rounded-2xl border bg-card px-5 py-10 text-center text-sm text-muted-foreground">No actions are waiting for a second person's approval.</p>
      ) : (
        <ul className="divide-y rounded-2xl border bg-card">
          {items.map((a) => (
            <li key={a.id} className="space-y-3 px-5 py-4">
              <div>
                <div className="font-medium">{a.summary}</div>
                <div className="text-sm text-muted-foreground">Asked by {a.requestedBy} · {new Date(a.createdAt).toLocaleString()}</div>
              </div>
              {a.own ? (
                <p className="text-sm text-muted-foreground">This is your own request, so someone else has to decide it.</p>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Input aria-label="Reason" placeholder="Reason (required)" className="max-w-xs" value={reasons[a.id] ?? ""} onChange={(e) => setReasons((r) => ({ ...r, [a.id]: e.target.value }))} />
                  <Button size="sm" disabled={busy !== null || !(reasons[a.id] ?? "").trim()} onClick={() => decide(a, "approve")}>{busy === a.id + "approve" ? <Loader2 className="animate-spin" /> : <Check />} Approve</Button>
                  <Button size="sm" variant="outline" disabled={busy !== null || !(reasons[a.id] ?? "").trim()} onClick={() => decide(a, "decline")}><X /> Decline</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
