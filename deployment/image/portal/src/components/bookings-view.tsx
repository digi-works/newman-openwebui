"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BookingDialog, STATUS_LABEL, STATUS_STYLE } from "@/components/booking-dialog";
import { Button } from "@/components/ui/button";
import { SegmentedTabs } from "@/components/segmented-tabs";
import type { Booking } from "@/lib/bookings";
import { cn } from "@/lib/utils";

const QUEUES = [
  { value: "awaiting", label: "Awaiting approval", title: "Awaiting approval", blurb: "Requests waiting for a decision.", test: (b: Booking) => b.status === "Tentative" },
  { value: "all", label: "All bookings", title: "All bookings", blurb: "Every room request across campus this term.", test: () => true },
  { value: "upcoming", label: "Upcoming", title: "Upcoming", blurb: "Bookings from today onward.", test: (b: Booking, today: string) => b.date >= today },
  { value: "confirmed", label: "Confirmed", title: "Confirmed", blurb: "Bookings that are locked in.", test: (b: Booking) => b.status === "Confirmed" },
  { value: "declined", label: "Closed", title: "Closed", blurb: "Declined, cancelled or expired requests.", test: (b: Booking) => ["Declined", "Cancelled", "Expired"].includes(b.status) },
] as const;

const fmtDate = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const OWN_TEXT: Record<string, { label: string; title: string; blurb: string }> = {
  awaiting: { label: "Waiting", title: "Waiting for a decision", blurb: "Your requests that no one has decided yet." },
  all: { label: "My bookings", title: "My bookings", blurb: "The room requests you have made." },
  upcoming: { label: "Upcoming", title: "Upcoming", blurb: "Your bookings from today onward." },
  confirmed: { label: "Confirmed", title: "Confirmed", blurb: "Your requests that were approved." },
  declined: { label: "Closed", title: "Closed", blurb: "Your requests that were declined, cancelled or expired." },
};

export function BookingsView({ bookings, today, canDecide, canDecideOwn, canEdit, canCancel, canRequest, ownOnly = false, viewer }: {
  bookings: Booking[]; today: string; canDecide: boolean; canDecideOwn: boolean; canEdit: boolean; canCancel: boolean; canRequest: boolean; ownOnly?: boolean; viewer: { id: string; email: string };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [queue, setQueue] = useState<(typeof QUEUES)[number]["value"]>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const open = bookings.find((b) => b.id === openId) ?? null;
  const queues = useMemo(() => QUEUES.map((q) => (ownOnly ? { ...q, ...OWN_TEXT[q.value] } : q)), [ownOnly]);
  const counts = useMemo(() => Object.fromEntries(queues.map((q) => [q.value, bookings.filter((b) => q.test(b, today)).length])), [queues, bookings, today]);
  const current = queues.find((q) => q.value === queue)!;
  const rows = bookings.filter((b) => current.test(b, today));

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 md:flex-row md:gap-8">
      {/* queues: left rail on desktop, segmented control on small screens */}
      <nav aria-label="Queues" className="hidden w-48 shrink-0 md:block">
        <p className="mb-3 px-3 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Queues</p>
        <ul className="space-y-1">
          {queues.map((q) => (
            <li key={q.value}>
              <button
                onClick={() => setQueue(q.value)}
                aria-current={q.value === queue ? "page" : undefined}
                className={cn("flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors", q.value === queue ? "bg-accent font-semibold text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
              >
                {q.label}
                <span className="rounded-full bg-background px-2 text-xs tabular-nums ring-1 ring-border">{counts[q.value]}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <SegmentedTabs className="md:hidden" label="Queues" value={queue} onChange={(v) => setQueue(v as typeof queue)} items={queues.map((q) => ({ value: q.value, label: q.label, count: counts[q.value] }))} />

      <div className="min-w-0 flex-1 space-y-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-semibold tracking-tight text-primary md:text-5xl">{current.title}</h1>
            <p className="mt-1 text-muted-foreground">{canDecide && !ownOnly && current.value === "awaiting" ? "Requests waiting for a decision. Open one to approve or decline it." : current.blurb}</p>
          </div>
          <div className="flex gap-2">
            {canRequest && <Button render={<Link href="/bookings/new" />}><Plus /> Request a room</Button>}
            <Button variant="outline" onClick={() => start(() => router.refresh())} disabled={pending}>
              <RefreshCw className={cn(pending && "animate-spin")} /> Refresh
            </Button>
          </div>
        </div>

        {notice && (
          <div role="status" className="flex items-center justify-between gap-3 rounded-xl border border-emerald-600/30 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:bg-emerald-400/10 dark:text-emerald-200">
            <span>{notice}</span>
            <button onClick={() => setNotice("")} className="font-medium underline underline-offset-4">Dismiss</button>
          </div>
        )}
        <div className="overflow-hidden rounded-2xl border bg-card shadow-xs">
          <div className="border-b px-5 py-3.5 text-sm font-semibold">Booking details</div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-[0.12em] text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Room</th>
                  <th className="px-3 py-3 font-medium">Requested by</th>
                  <th className="whitespace-nowrap px-3 py-3 font-medium">Date &amp; time</th>
                  <th className="px-3 py-3 font-medium">Purpose</th>
                  <th className="px-5 py-3 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={5} className="px-5 py-12 text-center text-muted-foreground">Nothing in this queue right now.</td></tr>
                ) : rows.map((b) => (
                  <tr key={b.id} tabIndex={0} role="button" aria-label={`Open booking for ${b.room}${canDecide && b.status === "Tentative" ? ", waiting for your decision" : ""}`} onClick={() => setOpenId(b.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenId(b.id); } }} className="cursor-pointer border-b outline-none last:border-0 hover:bg-muted/40 focus-visible:bg-muted/60">
                    <td className="px-5 py-3.5 font-medium">{b.room}<div className="font-mono text-xs font-normal text-muted-foreground">{b.ref}</div></td>
                    <td className="px-3 py-3.5"><div className="font-medium">{b.requestedBy}</div><div className="text-xs text-muted-foreground">{b.email}</div></td>
                    <td className="whitespace-nowrap px-3 py-3.5 tabular-nums"><div className="font-medium">{fmtDate(b.date)}</div><div className="text-xs text-muted-foreground">{b.start} – {b.end}</div></td>
                    <td className="px-3 py-3.5">{b.purpose}</td>
                    <td className="whitespace-nowrap px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {/* a person who can decide sees from the queue that a waiting request needs them; the whole row opens it (QA DEF-24) */}
                        {canDecide && b.status === "Tentative" && <span aria-hidden className="rounded-md bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground">Approve or decline</span>}
                        <Badge variant="outline" className={cn("border-0", STATUS_STYLE[b.status])}>{STATUS_LABEL[b.status]}</Badge>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <BookingDialog
        booking={open}
        viewer={viewer}
        can={{ decide: canDecide, decideOwn: canDecideOwn, edit: canEdit, cancel: canCancel }}
        onClose={() => setOpenId(null)}
        onChanged={(message) => { setOpenId(null); setNotice(message); router.refresh(); }}
      />
    </div>
  );
}
