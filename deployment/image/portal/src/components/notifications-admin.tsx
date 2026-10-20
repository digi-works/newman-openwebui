"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { NotificationSettings } from "@/lib/booking-emails";

export type EmailLogItem = { at: string; kind: string; status: string; error: string | null };

/** Settings > Notifications: room booking emails, the room manager inbox, calendar invites, and a test email. */
export function NotificationsAdmin({ initial, mail, log }: { initial: NotificationSettings; mail: { configured: boolean; from: string }; log: EmailLogItem[] }) {
  const [s, setS] = useState(initial);
  const [managers, setManagers] = useState(initial.managerEmails.join(", "));
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(next: NotificationSettings & { managerText?: string }, what: string) {
    setBusy(what); setMsg(null);
    const res = await fetch("/api/admin/notifications", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingEmails: next.bookingEmails, eventInvites: next.eventInvites, managerEmails: next.managerText ?? managers }),
    }).catch(() => null);
    const out = res ? await res.json().catch(() => ({})) : {};
    setBusy(null);
    if (!res || !res.ok) { setMsg({ ok: false, text: out.error ?? "Could not save. Try again." }); return; }
    setS(out.settings); setManagers(out.settings.managerEmails.join(", "));
    setMsg({ ok: true, text: "Saved." });
  }
  async function test() {
    setBusy("test"); setMsg(null);
    const res = await fetch("/api/admin/notifications", { method: "POST" }).catch(() => null);
    const out = res ? await res.json().catch(() => ({})) : {};
    setBusy(null);
    setMsg(res?.ok ? { ok: true, text: `Test email sent to ${out.to}. Check that inbox (and its junk folder).` } : { ok: false, text: out.error ?? "Could not send the test email." });
  }

  const spin = (what: string) => busy === what && <Loader2 className="animate-spin" />;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
        <p className="text-sm text-muted-foreground">Emails Digi sends about room bookings and events. The notification bell in Digi works either way.</p>
      </div>

      {!mail.configured && (
        <p role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          Email is not set up on this server yet, so these cannot be switched on. Your Digi administrator adds the Microsoft settings (MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MAIL_FROM) to the server; see the deployment README.
        </p>
      )}

      <section className="space-y-4 rounded-2xl border bg-card p-5 text-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-medium">Room booking email notifications</div>
            <p className="mt-1 text-muted-foreground">
              {s.bookingEmails
                ? "On. New requests are emailed to the room manager with Approve and Reject buttons, and the requester gets an email when they ask and whenever their request is approved, declined, cancelled or expires."
                : "Off. Nobody is emailed about room bookings."}
            </p>
          </div>
          <Button size="sm" variant={s.bookingEmails ? "outline" : "default"} disabled={busy !== null || (!mail.configured && !s.bookingEmails)} onClick={() => save({ ...s, bookingEmails: !s.bookingEmails }, "booking")}>
            {spin("booking")} {s.bookingEmails ? "Switch off" : "Switch on"}
          </Button>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="managers" className="font-medium">Room manager email</label>
          <div className="flex gap-2">
            <Input id="managers" value={managers} onChange={(e) => setManagers(e.target.value)} placeholder="rooms@example.edu" />
            <Button variant="outline" disabled={busy !== null || managers.trim() === s.managerEmails.join(", ")} onClick={() => save(s, "managers")}>{spin("managers")} Save</Button>
          </div>
          <p className="text-xs text-muted-foreground">Receives every new request. Separate several with commas. To approve or reject from the email, this address needs a Digi account that can approve room requests.</p>
        </div>
      </section>

      <section className="space-y-2 rounded-2xl border bg-card p-5 text-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-medium">Calendar invites</div>
            <p className="mt-1 text-muted-foreground">
              {s.eventInvites
                ? "On. When someone asks Digi to schedule an event and confirms it, the attendees get a calendar invite with Yes, Maybe and No."
                : "Off. Digi cannot send calendar invites."}
            </p>
          </div>
          <Button size="sm" variant={s.eventInvites ? "outline" : "default"} disabled={busy !== null || (!mail.configured && !s.eventInvites)} onClick={() => save({ ...s, eventInvites: !s.eventInvites }, "invites")}>
            {spin("invites")} {s.eventInvites ? "Switch off" : "Switch on"}
          </Button>
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border bg-card p-5 text-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-medium">Sending mailbox</div>
            <p className="mt-1 text-muted-foreground">{mail.configured ? `Emails are sent from ${mail.from}.` : "Not set up."}</p>
          </div>
          <Button size="sm" variant="outline" disabled={busy !== null || !mail.configured} onClick={test}>{spin("test")} Send me a test email</Button>
        </div>
        {log.length > 0 && (
          <div>
            <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Recent emails</div>
            <ul className="divide-y rounded-lg border">
              {log.map((l, i) => (
                <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-2">
                  <span>{l.kind}</span>
                  <span className={l.status === "failed" ? "text-destructive" : "text-muted-foreground"}>{l.status === "completed" ? "sent" : l.status}{l.error && l.status !== "completed" ? `: ${l.error}` : ""} · {new Date(l.at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {msg && <p role="status" className={msg.ok ? "flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-300" : "text-sm text-destructive"}>{msg.ok && <Check className="size-4" />}{msg.text}</p>}
    </div>
  );
}
