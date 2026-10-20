import { redirect } from "next/navigation";
import { ApprovalsView } from "@/components/approvals-view";
import { pendingCount } from "@/lib/booking-service";
import { listPending } from "@/lib/approvals";
import { P } from "@/lib/permissions";
import { authLive, can, requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const user = await requirePermission(P.approvalsDecide);
  if (!user) redirect("/");
  const items = authLive() ? await listPending(user) : [];
  // Room requests are decided on Bookings, not here. Say so, with the bell's count, so this page never reads as "nothing to decide" (QA DEF-02).
  const rooms = authLive() && can(user, P.bookingsApprove) ? await pendingCount(user.tenantId).catch(() => 0) : 0;
  return (
    <div className="p-4 md:p-8">
      {rooms > 0 && (
        <div role="status" className="mx-auto mb-6 flex max-w-3xl flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card px-5 py-4">
          <div className="text-sm">
            <div className="font-medium">{rooms} room {rooms === 1 ? "request is" : "requests are"} waiting for a decision</div>
            <div className="text-muted-foreground">Room requests are approved or declined on the Bookings page, not here.</div>
          </div>
          <a href="/bookings" className="shrink-0 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80">Review room requests</a>
        </div>
      )}
      <ApprovalsView initial={items} />
    </div>
  );
}
