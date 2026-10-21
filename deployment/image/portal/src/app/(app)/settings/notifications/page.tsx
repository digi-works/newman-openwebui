import { redirect } from "next/navigation";
import { NotificationsAdmin, type EmailLogItem } from "@/components/notifications-admin";
import { getNotificationSettings } from "@/lib/booking-emails";
import { withTenant } from "@/lib/digi-db";
import { mailConfigured, mailFrom } from "@/lib/mail";
import { P } from "@/lib/permissions";
import { authLive, requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = {
  created: "New request (manager and requester)", approved: "Approved", declined: "Declined", cancelled: "Cancelled", replaced: "Replaced by a priority request", expired: "Expired",
};

export default async function NotificationsPage() {
  const viewer = await requirePermission(P.bookingsApprove);
  if (!viewer) redirect("/settings");
  const live = authLive();
  const settings = live ? await getNotificationSettings(viewer.tenantId) : { bookingEmails: false, managerEmails: [] };
  // the last few email jobs, so a wrong secret or a full mailbox shows here rather than only in the server log
  const log: EmailLogItem[] = live
    ? (await withTenant(viewer.tenantId, (c) => c.query("select created_at, payload, status, error from jobs where type = 'email.booking' order by created_at desc limit 8"))).rows
        .map((r) => ({ at: new Date(r.created_at).toISOString(), kind: `${KIND[r.payload?.kind] ?? "Booking email"}`, status: r.status, error: r.error }))
    : [];
  return (
    <div className="p-4 md:p-8">
      <NotificationsAdmin initial={settings} mail={{ configured: mailConfigured(), from: mailFrom() }} log={log} />
    </div>
  );
}
