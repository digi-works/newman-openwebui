import { createHmac, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { auditEvent } from "./audit";
import type { Booking } from "./bookings";
import { getBrand } from "./brand";
import { withTenant } from "./digi-db";
import { bookingUpdateEmail, managerRequestEmail, requestReceivedEmail, type BookingUpdate } from "./email-templates";
import { mailConfigured, MailError, sendMail } from "./mail";
import { accessFor } from "./session";

/**
 * Room booking emails (Settings > Notifications > "Room booking email notifications").
 * - A new request: the room manager inboxes get it with Approve / Reject links; the requester gets "request received".
 * - A decision, a cancellation by someone else, a replacement by a priority request, or an expiry: the requester is told.
 * Emails are queued as jobs in the same transaction as the booking change, so they go out only if the change was saved, are retried if
 * Microsoft is briefly unavailable, and never twice (one idempotency key per booking and kind). The in-app bell is unchanged.
 */
export type NotificationSettings = { bookingEmails: boolean; managerEmails: string[] };
export type BookingEmailKind = "created" | BookingUpdate;

const EMAIL = /^[^@\s,;<>]+@[^@\s,;<>]+\.[A-Za-z]{2,}$/;
export const parseEmails = (v: string) => [...new Set(v.split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))];
export const validEmail = (v: string) => EMAIL.test(v);

/** BOOKING_MANAGER_EMAIL is the starting value until an admin saves the setting. */
const defaultManagers = () => parseEmails(process.env.BOOKING_MANAGER_EMAIL || "").filter(validEmail);

/**
 * Until an admin saves the setting, booking emails are on wherever they can work: email is set up and there is a room manager inbox.
 * Before, they started off, and a server with working email sent no booking emails until someone found the switch.
 */
export async function readSettings(c: PoolClient): Promise<NotificationSettings> {
  const r = (await c.query("select booking_emails_enabled, booking_manager_emails from notification_settings")).rows[0];
  if (!r) { const managerEmails = defaultManagers(); return { bookingEmails: mailConfigured() && managerEmails.length > 0, managerEmails }; }
  return { bookingEmails: r.booking_emails_enabled, managerEmails: parseEmails(r.booking_manager_emails).filter(validEmail) };
}

export const getNotificationSettings = (tenantId: string) => withTenant(tenantId, readSettings);

export async function saveNotificationSettings(tenantId: string, userId: string, s: NotificationSettings) {
  await withTenant(tenantId, async (c) => {
    await c.query(
      `insert into notification_settings (tenant_id, booking_emails_enabled, booking_manager_emails, updated_by)
       values ($1, $2, $3, $4)
       on conflict (tenant_id) do update set booking_emails_enabled = $2, booking_manager_emails = $3, updated_by = $4, updated_at = now()`,
      [tenantId, s.bookingEmails, s.managerEmails.join(", "), userId],
    );
    await auditEvent(c, { tenantId, userId, action: "settings.notifications", entityType: "tenant", entityId: tenantId, metadata: { bookingEmails: s.bookingEmails, managers: s.managerEmails.length } });
  });
}

const insertJob = `insert into jobs (tenant_id, type, payload, actor_user_id, idempotency_key, max_attempts)
  values ($1, 'email.booking', $2, $3, $4, 5) on conflict (tenant_id, idempotency_key) where idempotency_key is not null do nothing`;

/** Called inside the booking transaction. Does nothing while booking emails are off or email is not set up. */
export async function queueBookingEmail(c: PoolClient, tenantId: string, actorUserId: string, bookingId: string, kind: BookingEmailKind) {
  if (!mailConfigured() || !(await readSettings(c)).bookingEmails) return;
  await c.query(insertJob, [tenantId, JSON.stringify({ bookingId, kind }), actorUserId, `booking-email:${bookingId}:${kind}`]);
}

/** Expiry happens without anyone acting, so each email runs as the requester. Matches the rows expireStale has just closed. */
export async function queueExpiryEmails(c: PoolClient, tenantId: string) {
  if (!mailConfigured() || !(await readSettings(c)).bookingEmails) return;
  await c.query(
    `insert into jobs (tenant_id, type, payload, actor_user_id, idempotency_key, max_attempts)
     select $1, 'email.booking', jsonb_build_object('bookingId', b.id, 'kind', 'expired'), b.requester_user_id, 'booking-email:' || b.id || ':expired', 5
       from bookings b join booking_events e on e.booking_id = b.id and e.action = 'expired' and e.created_at > now() - interval '5 seconds'
      where b.requester_user_id is not null and b.status = 'expired'
     on conflict (tenant_id, idempotency_key) where idempotency_key is not null do nothing`,
    [tenantId],
  );
}

/* ------------------------------------------------------------------ Approve / Reject links */
// A link proves only that its holder received the manager email. The decision itself is made, on a confirmation page, as the Digi user
// with that email address, who must hold the approve permission; the normal booking rules (not your own request, still waiting) apply.
const LINK_DAYS = 14;
const linkKey = () => createHmac("sha256", Buffer.from(process.env.DIGI_SECRET_KEY || "", "base64")).update("booking-email-link/v1").digest();

export type LinkClaims = { tenantId: string; bookingId: string; manager: string; exp: number };

export function signDecisionLink(claims: Omit<LinkClaims, "exp">): string {
  const body = Buffer.from(JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) + LINK_DAYS * 86400 })).toString("base64url");
  return `${body}.${createHmac("sha256", linkKey()).update(body).digest("base64url")}`;
}

export function verifyDecisionLink(token: string): LinkClaims | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  // compared as text: decoding base64url ignores the spare bits of the last character, so two spellings would pass
  const want = Buffer.from(createHmac("sha256", linkKey()).update(body).digest("base64url"));
  const got = Buffer.from(sig);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const c = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as LinkClaims;
    if (typeof c.tenantId !== "string" || typeof c.bookingId !== "string" || typeof c.manager !== "string" || !(c.exp > Date.now() / 1000)) return null;
    return c;
  } catch {
    return null;
  }
}

export const publicUrl = () => (process.env.PUBLIC_URL || `https://${getBrand().host}`).replace(/\/+$/, "");
export const decisionUrl = (token: string, decision: "approve" | "decline") => `${publicUrl()}/email-decision?t=${encodeURIComponent(token)}&d=${decision}`;

/** The Digi user who decides from a manager email: active, in this tenant, with the approve permission. Null when there is none. */
export async function managerActor(tenantId: string, email: string) {
  const u = await withTenant(tenantId, async (c) => (await c.query("select id, name, email from users where lower(email) = lower($1) and status = 'active'", [email])).rows[0]);
  if (!u) return null;
  const access = await accessFor(tenantId, u.id);
  return { id: u.id as string, tenantId, email: u.email as string, name: u.name as string, permissions: access.permissions };
}

/* ------------------------------------------------------------------ the job that sends them */
type SendCtx = { tenantId: string; payload: Record<string, unknown>; checkpoint: Record<string, unknown>; save: (cp: Record<string, unknown>) => Promise<void> };
/** What the sender reads and sends with; the defaults are the real database and Microsoft Graph (tests pass their own). */
export type SendDeps = {
  settings: (tenantId: string) => Promise<NotificationSettings>;
  booking: (tenantId: string, id: string) => Promise<Booking | null>;
  send: typeof sendMail;
};
const realDeps: SendDeps = {
  settings: getNotificationSettings,
  booking: async (tenantId, id) => (await import("./booking-service")).bookingById(tenantId, id),
  send: sendMail,
};

export async function sendBookingEmails({ tenantId, payload, checkpoint, save }: SendCtx, deps: SendDeps = realDeps) {
  const bookingId = String(payload.bookingId ?? ""), kind = String(payload.kind ?? "") as BookingEmailKind;
  const settings = await deps.settings(tenantId);
  if (!settings.bookingEmails) return { skipped: "Room booking emails were switched off." };
  const b = await deps.booking(tenantId, bookingId);
  if (!b) return { skipped: "The booking no longer exists." };

  // which recipients already have it, so a retry after a partial failure does not send twice
  const sent = new Set(Array.isArray(checkpoint.sent) ? (checkpoint.sent as string[]) : []);
  const send = async (key: string, to: string, mail: { subject: string; html: string }) => {
    if (sent.has(key) || !validEmail(to)) return;
    await deps.send({ to: [to], subject: mail.subject, html: mail.html, senderName: "Room Bookings" });
    sent.add(key);
    await save({ sent: [...sent] });
  };

  if (kind === "created") {
    // a request decided or withdrawn before the email went out no longer needs the manager
    if (b.status === "Tentative") {
      if (!settings.managerEmails.length) throw new MailError("No room manager email is set in Settings > Notifications.", true);
      for (const m of settings.managerEmails) {
        const token = signDecisionLink({ tenantId, bookingId, manager: m });
        await send(`manager:${m}`, m, managerRequestEmail(b, { approve: decisionUrl(token, "approve"), reject: decisionUrl(token, "decline") }));
      }
    }
    await send("requester", b.email, requestReceivedEmail(b));
  } else if (["approved", "declined", "cancelled", "replaced", "expired"].includes(kind)) {
    await send("requester", b.email, bookingUpdateEmail(b, kind as BookingUpdate));
  } else {
    throw new MailError(`Unknown booking email: ${kind}`, true);
  }
  return { sent: [...sent] };
}
