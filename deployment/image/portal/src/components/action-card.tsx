"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActionCard } from "@/lib/types";

/**
 * A write Digi prepared. Nothing has happened until the person presses Confirm here: this click, an authenticated request to Digi,
 * is what commits it. Typing "yes" in the chat cannot.
 */
export function ActionCardView({ action }: { action: ActionCard }) {
  const [a, setA] = useState(action);
  const [busy, setBusy] = useState<"confirm" | "cancel" | null>(null);
  const [error, setError] = useState("");

  async function act(kind: "confirm" | "cancel") {
    setBusy(kind); setError("");
    const res = await fetch(`/api/actions/${a.id}/${kind}`, { method: "POST" }).catch(() => null);
    const out = res ? await res.json().catch(() => ({})) : {};
    setBusy(null);
    if (out.action) setA((p) => ({ ...p, ...out.action }));
    if (!res || !res.ok) setError(out.error ?? "Could not do that. Try again.");
  }

  const ref = typeof a.result?.ref === "string" ? a.result.ref : "";
  return (
    <div className="max-w-lg rounded-xl border bg-card p-4" data-action-status={a.status}>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {a.status === "pending" ? "Please confirm" : a.status === "confirmed" ? "Done" : a.status === "cancelled" ? "Cancelled" : a.status === "expired" ? "Expired" : "Not done"}
      </div>
      <p className="mt-1 text-sm font-medium">{a.summary}</p>
      {a.status === "pending" && (
        <>
          <p className="mt-1 text-xs text-muted-foreground">Digi has only prepared this. It happens when you press Confirm.</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" disabled={busy !== null} onClick={() => act("confirm")}>{busy === "confirm" ? <Loader2 className="animate-spin" /> : <Check />} Confirm</Button>
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => act("cancel")}><X /> Not now</Button>
          </div>
        </>
      )}
      {a.status === "confirmed" && (
        <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-300">
          {ref ? <>Sent as <b>{ref}</b>. </> : null}
          {a.tool === "bookings.request" ? <>An approver will decide it. Follow it on the <Link className="underline" href="/bookings">Bookings page</Link>.</> : <>Saved.</>}
        </p>
      )}
      {a.status === "expired" && <p className="mt-1 text-sm text-muted-foreground">This was not confirmed in time. Ask Digi again.</p>}
      {(a.status === "failed" || error) && <p role="alert" className="mt-1 text-sm text-destructive">{a.error || error}</p>}
    </div>
  );
}
