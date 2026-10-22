"use client";

import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { isOwnBooking, type Booking, type BookingStatus } from "@/lib/bookings";
import { cn } from "@/lib/utils";
import { campusTime } from "@/lib/campus-time";

export const STATUS_STYLE: Record<BookingStatus, string> = {
  Tentative: "bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300",
  Confirmed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-300",
  Declined: "bg-red-100 text-red-800 dark:bg-red-400/15 dark:text-red-300",
  Cancelled: "bg-slate-200 text-slate-700 dark:bg-slate-400/15 dark:text-slate-300",
  Expired: "bg-slate-200 text-slate-700 dark:bg-slate-400/15 dark:text-slate-300",
};

/** Waiting requests read better as "Waiting" than the internal word "Tentative". */
export const STATUS_LABEL: Record<BookingStatus, string> = { Tentative: "Waiting", Confirmed: "Confirmed", Declined: "Declined", Cancelled: "Cancelled", Expired: "Expired" };

export type DialogAbilities = { decide: boolean; edit: boolean; cancel: boolean };

const fmt = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border bg-muted/40 p-5", className)}>
      <h3 className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Rows({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="space-y-3 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-6">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="text-right font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function BookingDialog({ booking, viewer, can, onClose, onChanged }: {
  booking: Booking | null;
  viewer: { id: string; email: string };
  can: DialogAbilities;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  return (
    <Dialog open={!!booking} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent showCloseButton={false} className="flex max-h-[90svh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        {booking && <Body key={`${booking.id}-${booking.version}`} booking={booking} viewer={viewer} can={can} onClose={onClose} onChanged={onChanged} />}
      </DialogContent>
    </Dialog>
  );
}

type Busy = "approve" | "decline" | "cancel" | "save" | null;

function Body({ booking: b, viewer, can, onClose, onChanged }: {
  booking: Booking; viewer: { id: string; email: string }; can: DialogAbilities; onClose: () => void; onChanged: (message: string) => void;
}) {
  const own = isOwnBooking(b, viewer);
  const waiting = b.status === "Tentative";
  const [reason, setReason] = useState("");
  const [purpose, setPurpose] = useState(b.purpose);
  const [attendees, setAttendees] = useState(String(b.attendees));
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState("");
  // Cancelling asks first (Jira WOR-142): the first press shows "This cannot be undone", the second cancels.
  const [confirmCancel, setConfirmCancel] = useState(false);

  const pct = Math.min(100, Math.round((b.attendees / b.capacity) * 100));
  const over = b.attendees > b.capacity;

  async function call(kind: Exclude<Busy, null>, url: string, method: string, body: unknown, done: string) {
    setBusy(kind);
    setError("");
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "That didn’t go through. Try again."); setBusy(null); return; }
      onChanged(done);
    } catch {
      setError("Can’t reach the portal. Check your connection and try again.");
      setBusy(null);
    }
  }

  const decide = (decision: "approve" | "decline") => {
    if (!reason.trim()) { setError("Add a short reason for this decision."); return; }
    void call(decision, `/api/bookings/${b.id}/decision`, "POST", { decision, reason, version: b.version }, `${b.room} ${decision === "approve" ? "approved" : "declined"}. The requester is notified in the app.`);
  };
  const cancel = () => {
    if (!own && !reason.trim()) { setError("Add a short reason for cancelling someone else’s booking."); return; }
    if (!confirmCancel) { setConfirmCancel(true); return; }
    setConfirmCancel(false);
    void call("cancel", `/api/bookings/${b.id}/cancel`, "POST", { reason }, `${b.room} cancelled.`);
  };
  const save = () => {
    const n = Number(attendees);
    if (!purpose.trim()) { setError("Say what the booking is for."); return; }
    if (!Number.isInteger(n) || n < 1) { setError("Enter how many people are coming."); return; }
    void call("save", `/api/bookings/${b.id}`, "PATCH", { purpose, attendees: n }, "Your request was updated.");
  };

  return (
    <>
      <header className="flex items-start justify-between gap-4 border-b px-6 py-5">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">{b.ref}</p>
          <DialogTitle className="mt-0.5 text-2xl font-semibold tracking-tight">{b.room}</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted-foreground">
            Submitted {fmt(b.submitted)}{b.expiresAt && waiting ? ` · expires ${campusTime(b.expiresAt, { month: "short", day: "numeric" })} if no one decides` : ""}
          </DialogDescription>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={cn("border-0", STATUS_STYLE[b.status])}>{STATUS_LABEL[b.status]}</Badge>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close"><X /></Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
        <Section title="Requester">
          <Rows rows={[["Name", b.requestedBy], ["Email", b.email]]} />
        </Section>

        <Section title="Request">
          <Rows rows={[["Date", fmt(b.date)], ["Time", `${b.start} – ${b.end}`], ["Purpose", b.purpose], ["Building", b.building]]} />
          <div className="mt-5 space-y-2">
            <div className="flex items-baseline justify-between text-sm">
              <span><span className="text-muted-foreground">Attendees</span> <span className="ml-2 text-base font-semibold tabular-nums">{b.attendees}</span></span>
              <span className={cn("text-xs", over ? "font-medium text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>{over ? `over capacity of ${b.capacity}` : `capacity ${b.capacity}`}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-border" role="img" aria-label={`${b.attendees} of ${b.capacity} seats`}>
              <div className={cn("h-full rounded-full", over ? "bg-amber-500" : "bg-emerald-600")} style={{ width: `${pct}%` }} />
            </div>
          </div>
          {b.needs.length > 0 && (
            <div className="mt-5 space-y-2">
              <p className="text-sm text-muted-foreground">Room needs</p>
              <div className="flex flex-wrap gap-2">{b.needs.map((n) => <span key={n} className="rounded-md border bg-background px-2.5 py-1 text-sm">{n}</span>)}</div>
            </div>
          )}
        </Section>

        <Section title="Room">
          <Rows rows={[["Room name", b.room], ["Capacity", b.capacity], ["Features", b.features]]} />
        </Section>

        {/* An approver decides someone else's waiting request. */}
        {waiting && can.decide && !own && (
          <section className="rounded-xl border border-primary/40 bg-accent/40 p-5">
            <h3 className="text-sm font-semibold">Decision</h3>
            <label htmlFor="reason" className="mt-3 block text-sm font-medium">Reason <span className="text-destructive">*</span></label>
            <Textarea id="reason" value={reason} onChange={(e) => { setReason(e.target.value); setError(""); }} rows={3} placeholder="Reason for this decision…" className="mt-1.5 bg-background" />
            <p className="mt-1.5 text-xs text-muted-foreground">Saved with the booking and shown to the requester in the app.</p>
            {error && <p role="alert" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Button variant="outline" size="lg" className="h-10" disabled={!!busy} onClick={() => decide("decline")}>
                {busy === "decline" && <Loader2 className="animate-spin" />}Decline
              </Button>
              <Button size="lg" className="h-10" disabled={!!busy} onClick={() => decide("approve")}>
                {busy === "approve" ? <Loader2 className="animate-spin" /> : <Check />}Approve request
              </Button>
            </div>
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              Approving confirms the booking and holds the room. The database makes sure no one else can book it at the same time.
            </p>
          </section>
        )}

        {waiting && own && (
          <section className="rounded-xl border bg-muted/40 p-5">
            <h3 className="text-sm font-semibold">Your request</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {can.decide ? "You made this request, so another approver has to decide it." : "This request is waiting for a decision from an approver."}
            </p>
            {can.edit && (
              <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_8rem]">
                <div className="space-y-1.5"><label htmlFor="purpose" className="text-sm font-medium">Purpose</label><Input id="purpose" value={purpose} maxLength={200} onChange={(e) => { setPurpose(e.target.value); setError(""); }} /></div>
                <div className="space-y-1.5"><label htmlFor="attendees" className="text-sm font-medium">People</label><Input id="attendees" type="number" min={1} value={attendees} onChange={(e) => { setAttendees(e.target.value); setError(""); }} /></div>
              </div>
            )}
            {error && <p role="alert" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
            {(can.edit || can.cancel) && (
              <div className="mt-4 flex flex-wrap gap-2">
                {can.edit && <Button disabled={!!busy} onClick={save}>{busy === "save" && <Loader2 className="animate-spin" />} Save changes</Button>}
                {can.cancel && <Button variant={confirmCancel ? "destructive" : "outline"} disabled={!!busy} onClick={cancel}>{busy === "cancel" && <Loader2 className="animate-spin" />} {confirmCancel ? "Yes, cancel request" : "Cancel request"}</Button>}
                {can.cancel && confirmCancel && <Button variant="outline" disabled={!!busy} onClick={() => setConfirmCancel(false)}>Keep it</Button>}
                {can.cancel && confirmCancel && <p className="w-full text-sm text-muted-foreground">Cancel this request? This cannot be undone.</p>}
              </div>
            )}
            <p className="mt-3 text-xs text-muted-foreground">To change the room or the time, cancel this request and make a new one.</p>
          </section>
        )}

        {waiting && !own && !can.decide && (
          <p className="rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground">This request is waiting for a decision from an approver.</p>
        )}

        {/* A confirmed booking can be cancelled by its requester, or by an approver with a reason. */}
        {b.status === "Confirmed" && (own ? can.cancel : can.decide) && (
          <section className="rounded-xl border bg-muted/40 p-5">
            <h3 className="text-sm font-semibold">Cancel this booking</h3>
            {!own && (
              <>
                <label htmlFor="creason" className="mt-3 block text-sm font-medium">Reason <span className="text-destructive">*</span></label>
                <Textarea id="creason" value={reason} onChange={(e) => { setReason(e.target.value); setError(""); }} rows={2} className="mt-1.5 bg-background" placeholder="Why is it being cancelled?" />
              </>
            )}
            {error && <p role="alert" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
            {confirmCancel && <p className="mt-3 text-sm text-muted-foreground">Cancel this booking? This cannot be undone.</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant={confirmCancel ? "destructive" : "outline"} disabled={!!busy} onClick={cancel}>{busy === "cancel" && <Loader2 className="animate-spin" />} {confirmCancel ? "Yes, cancel booking" : "Cancel booking"}</Button>
              {confirmCancel && <Button variant="outline" disabled={!!busy} onClick={() => setConfirmCancel(false)}>Keep it</Button>}
            </div>
          </section>
        )}

        {!waiting && b.decisionNote && (
          <section className="rounded-xl border bg-muted/40 p-5 text-sm">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{STATUS_LABEL[b.status]}</h3>
            <p className="text-muted-foreground">{b.decisionNote}</p>
          </section>
        )}
      </div>
    </>
  );
}
