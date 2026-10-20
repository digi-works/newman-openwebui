import Link from "next/link";
import { CircleCheck, CircleX, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { verifyDecisionLink } from "@/lib/booking-emails";
import { bookingById } from "@/lib/booking-service";
import { getBrand } from "@/lib/brand";
import { decideFromEmail } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Room request decision", robots: { index: false } };

/**
 * Where the Approve / Reject buttons of a room manager email land. Opening the link changes nothing (mail scanners open links too):
 * the manager confirms here, with a note, and the decision is saved as their Digi account. No sign-in is needed; the signed link is the key.
 */
export default async function EmailDecisionPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const token = q.t ?? "";
  const decision = q.d === "decline" ? "decline" : "approve";
  const claims = verifyDecisionLink(token);
  const booking = claims ? await bookingById(claims.tenantId, claims.bookingId) : null;
  const brand = getBrand();

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-lg space-y-5 rounded-2xl border bg-card p-6 shadow-sm">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">{brand.org} · Room booking</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">Room request decision</h1>
        </div>

        {!booking ? (
          <Notice tone="bad" text="This link is not valid or has expired. You can still decide on the Bookings page in Digi." />
        ) : (
          <>
            <dl className="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-2 rounded-xl border p-4 text-sm">
              <dt className="text-muted-foreground">Reference</dt><dd className="font-medium">{booking.ref}</dd>
              <dt className="text-muted-foreground">Room</dt><dd>{booking.room}, {booking.building}</dd>
              <dt className="text-muted-foreground">When</dt><dd>{booking.date}, {booking.start} to {booking.end}</dd>
              <dt className="text-muted-foreground">People</dt><dd>{booking.attendees}</dd>
              <dt className="text-muted-foreground">Purpose</dt><dd>{booking.purpose}</dd>
              <dt className="text-muted-foreground">Requested by</dt><dd>{booking.requestedBy} ({booking.email})</dd>
            </dl>

            {q.done ? (
              <Notice tone={q.done === "decline" ? "bad" : "good"} text={q.done === "decline" ? "Declined. The requester has been told." : "Approved. The requester has been told."} />
            ) : booking.status !== "Tentative" ? (
              <Notice tone="warn" text={`This request is already ${booking.status === "Confirmed" ? "approved" : booking.status.toLowerCase()}, so there is nothing to decide.`} />
            ) : (
              <form action={decideFromEmail} className="space-y-4">
                <input type="hidden" name="t" value={token} />
                <fieldset className="flex gap-2">
                  <legend className="mb-2 text-sm font-medium">Your decision</legend>
                  {(["approve", "decline"] as const).map((d) => (
                    <label key={d} className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                      <input type="radio" name="decision" value={d} defaultChecked={d === decision} /> {d === "approve" ? "Approve" : "Reject"}
                    </label>
                  ))}
                </fieldset>
                <div className="space-y-1.5">
                  <label htmlFor="reason" className="text-sm font-medium">Note to the requester</label>
                  <Textarea id="reason" name="reason" required maxLength={1000} defaultValue={decision === "approve" ? "Approved." : ""} placeholder="For example: the room is needed for an exam that day" />
                </div>
                {q.error && <p role="alert" className="text-sm text-destructive">{q.error}</p>}
                <Button type="submit" className="w-full">Confirm decision</Button>
              </form>
            )}
          </>
        )}
        <p className="text-center text-xs text-muted-foreground">
          <Link href="/bookings" className="underline underline-offset-2">Open the Bookings page</Link>
        </p>
      </div>
    </main>
  );
}

function Notice({ tone, text }: { tone: "good" | "bad" | "warn"; text: string }) {
  const Icon = tone === "good" ? CircleCheck : tone === "bad" ? CircleX : TriangleAlert;
  const color = tone === "good" ? "text-emerald-600" : tone === "bad" ? "text-destructive" : "text-amber-600";
  return <p role="status" className="flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm"><Icon className={`mt-0.5 size-4 shrink-0 ${color}`} /> {text}</p>;
}
