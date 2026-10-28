"use client";

import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ApprovalRow } from "@/lib/approvals";
import { campusTime } from "@/lib/campus-time";

/** A waiting room request, as Approvals lists it. */
export type RoomRequestRow = {
  id: string; ref: string; room: string; building: string; date: string; start: string; end: string; attendees: number;
  purpose: string; requestedBy: string; submitted: string; version: number; own: boolean;
};

const day = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });

/** Room requests and other actions that wait for another person's decision. You cannot decide your own request. */
export function ApprovalsView({ initial, rooms: initialRooms = [] }: { initial: ApprovalRow[]; rooms?: RoomRequestRow[] }) {
  const [items, setItems] = useState(initial);
  const [rooms, setRooms] = useState(initialRooms);
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

  // the same decision as the Bookings page: a reason, and the version so a request someone else just decided is not decided twice
  async function decideRoom(b: RoomRequestRow, decision: "approve" | "decline") {
    setBusy(b.id + decision); setError("");
    const res = await fetch(`/api/bookings/${b.id}/decision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, reason: reasons[b.id] ?? "", version: b.version }) }).catch(() => null);
    const out = res ? await res.json().catch(() => ({})) : {};
    setBusy(null);
    if (!res || !res.ok) { setError(out.error ?? "That did not work."); return; }
    setRooms((xs) => xs.filter((x) => x.id !== b.id));
  }

  const decision = (id: string, onDecide: (d: "approve" | "decline") => void) => (
    <div className="flex flex-wrap items-center gap-2">
      <Input aria-label="Reason" placeholder="Reason (required)" className="max-w-xs" value={reasons[id] ?? ""} onChange={(e) => setReasons((r) => ({ ...r, [id]: e.target.value }))} />
      <Button size="sm" disabled={busy !== null || !(reasons[id] ?? "").trim()} onClick={() => onDecide("approve")}>{busy === id + "approve" ? <Loader2 className="animate-spin" /> : <Check />} Approve</Button>
      <Button size="sm" variant="outline" disabled={busy !== null || !(reasons[id] ?? "").trim()} onClick={() => onDecide("decline")}>{busy === id + "decline" ? <Loader2 className="animate-spin" /> : <X />} Decline</Button>
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
        <p className="text-sm text-muted-foreground">Room requests and other actions that need another person to say yes before they happen.</p>
      </div>
      {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {rooms.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Room requests <span className="font-normal text-muted-foreground">({rooms.length})</span></h2>
          <ul className="divide-y rounded-2xl border bg-card">
            {rooms.map((b) => (
              <li key={b.id} className="space-y-3 px-5 py-4">
                <div>
                  <div className="font-medium">{b.room} <span className="font-normal text-muted-foreground">· {b.building}</span></div>
                  <div className="text-sm">{day(b.date)}, {b.start} to {b.end} · {b.attendees} {b.attendees === 1 ? "person" : "people"} · {b.purpose}</div>
                  <div className="text-sm text-muted-foreground">Asked by {b.requestedBy} · submitted {day(b.submitted)} · <span className="font-mono">{b.ref}</span></div>
                </div>
                {b.own ? <p className="text-sm text-muted-foreground">This is your own request, so another approver has to decide it.</p> : decision(b.id, (d) => void decideRoom(b, d))}
              </li>
            ))}
          </ul>
        </section>
      )}
      {items.length === 0 ? (
        rooms.length === 0 && <p className="rounded-2xl border bg-card px-5 py-10 text-center text-sm text-muted-foreground">Nothing is waiting for a decision.</p>
      ) : (
        <ul className="divide-y rounded-2xl border bg-card">
          {items.map((a) => (
            <li key={a.id} className="space-y-3 px-5 py-4">
              <div>
                <div className="font-medium">{a.summary}</div>
                <div className="text-sm text-muted-foreground">Asked by {a.requestedBy} · {campusTime(a.createdAt)}</div>
              </div>
              {a.own ? <p className="text-sm text-muted-foreground">This is your own request, so someone else has to decide it.</p> : decision(a.id, (d) => void decide(a, d))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
