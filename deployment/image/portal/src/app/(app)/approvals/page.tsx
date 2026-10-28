import { redirect } from "next/navigation";
import { ApprovalsView } from "@/components/approvals-view";
import { listBookings } from "@/lib/booking-service";
import { needsAnotherApprover } from "@/lib/bookings";
import { listPending } from "@/lib/approvals";
import { P } from "@/lib/permissions";
import { authLive, can, requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const user = await requirePermission(P.approvalsDecide);
  if (!user) redirect("/");
  const items = authLive() ? await listPending(user) : [];
  // Waiting room requests are listed and decided here too, the same decision as on Bookings (QA: admin's request not on Approvals).
  // Your own are listed; someone else has to decide them unless you can approve your own (Admins can).
  const rooms = authLive() && can(user, P.bookingsApprove)
    ? (await listBookings(user, true).catch(() => []))
        .filter((b) => b.status === "Tentative") // waiting (pending in the database)
        .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
        .map((b) => ({
          id: b.id, ref: b.ref, room: b.room, building: b.building, date: b.date, start: b.start, end: b.end, attendees: b.attendees,
          purpose: b.purpose, requestedBy: b.requestedBy, submitted: b.submitted, version: b.version, own: needsAnotherApprover(b, user),
        }))
    : [];
  return (
    <div className="p-4 md:p-8">
      <ApprovalsView initial={items} rooms={rooms} />
    </div>
  );
}
