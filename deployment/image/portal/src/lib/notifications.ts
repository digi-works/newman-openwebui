import { pendingApprovalCount } from "./approvals";
import { notificationsFor, pendingCount } from "./booking-service";
import { P } from "./permissions";
import { authLive, can, type SessionUser } from "./session";

export type Notification = { id: string; title: string; body: string; href: string; read?: boolean };

/**
 * What to show under the bell (in the app only; there is no email in Phase 1): requests waiting for people who can approve,
 * and decisions or cancellations on a person's own requests.
 */
export async function getNotifications(user: SessionUser): Promise<Notification[]> {
  if (!authLive()) return [];
  const out: Notification[] = [];
  try {
    if (can(user, P.bookingsApprove)) {
      const waiting = await pendingCount(user.tenantId);
      if (waiting > 0) {
        out.push({
          id: `approvals-${waiting}`,
          title: `${waiting} booking ${waiting === 1 ? "request is" : "requests are"} waiting for a decision`,
          body: "Review them in the Awaiting approval queue.",
          href: "/bookings",
        });
      }
    }
    const approvals = await pendingApprovalCount(user);
    if (approvals > 0) {
      out.push({ id: `decisions-${approvals}`, title: `${approvals} ${approvals === 1 ? "action is" : "actions are"} waiting for your approval`, body: "Review them on the Approvals page.", href: "/approvals" });
    }
    out.push(...(await notificationsFor(user)));
  } catch (e) {
    console.error("notifications failed", e);
  }
  return out;
}
