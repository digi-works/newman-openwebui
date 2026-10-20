import { randomUUID } from "node:crypto";
import { auditEvent } from "./audit";
import { getNotificationSettings, parseEmails, validEmail } from "./booking-emails";
import { withTenant } from "./digi-db";
import { inviteEmail, type InviteEvent } from "./email-templates";
import { mailConfigured, mailFrom, sendMime } from "./mail";
import { hhmm, to12h, toMinutes } from "./rooms";

/**
 * Calendar invites (the events.invite tool). The invite comes from MAIL_FROM as the organiser, as a real meeting request (iCalendar
 * METHOD:REQUEST), so Outlook, Gmail and Apple Mail show Yes / Maybe / No and put the event in the attendee's calendar. Replies go to the
 * organiser mailbox. The person who asked is invited too. Digi keeps no event record; the audit log notes who sent what to how many.
 */
export class InviteError extends Error {}

export type InviteInput = { title: string; date: string; start: string; end: string; attendees: string[]; location: string; description: string };

const MAX_ATTENDEES = 25;

export type RawInvite = { title: string; date: string; start: string; end: string; attendees: string; location: string; description: string };

/** The checks that need nothing but the request itself: a title, a real time span, real addresses, not too many people. */
export function normalizeInvite(raw: RawInvite): InviteInput {
  const title = raw.title.trim().slice(0, 150);
  if (!title) throw new InviteError("Say what the event is called.");
  const s = toMinutes(raw.start), e = toMinutes(raw.end);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.date) || s === null || e === null || e <= s) throw new InviteError("Give the date and a start time before the end time.");
  const attendees = parseEmails(raw.attendees);
  const bad = attendees.filter((a) => !validEmail(a));
  if (bad.length) throw new InviteError(`These are not email addresses: ${bad.join(", ")}. Ask the person for the right ones; never guess them.`);
  if (!attendees.length) throw new InviteError("Say who to invite (their email addresses).");
  if (attendees.length > MAX_ATTENDEES) throw new InviteError(`Digi can invite at most ${MAX_ATTENDEES} people at once.`);
  return { title, date: raw.date, start: hhmm(s), end: hhmm(e), attendees, location: raw.location.trim().slice(0, 200), description: raw.description.trim().slice(0, 1000) };
}

/** Everything normalizeInvite checks, plus the organisation's switch and that the start is still ahead in campus time. */
export async function checkInvite(tenantId: string, raw: RawInvite): Promise<InviteInput> {
  if (!mailConfigured() || !(await getNotificationSettings(tenantId)).eventInvites) {
    throw new InviteError("Calendar invites are switched off. Someone who approves room requests can switch them on in Settings > Notifications.");
  }
  const input = normalizeInvite(raw);
  const past = await withTenant(tenantId, async (c) => {
    const tz = ((await c.query("select configuration from tenants where id = $1", [tenantId])).rows[0]?.configuration?.timezone as string) || "America/Chicago";
    return (await c.query("select (($1::date + $2::time) at time zone $3) < now() as past", [input.date, input.start, tz])).rows[0].past as boolean;
  });
  if (past) throw new InviteError("That time has already passed.");
  return input;
}

/* ------------------------------------------------------------------ iCalendar and MIME */
const icsText = (v: string) => v.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1");
const utcStamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Lines longer than 75 octets are folded with CRLF + space (RFC 5545). */
export function fold(line: string) {
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > (out.length ? 74 : 75)) { out.push(cur); cur = ""; }
    cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
const header = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);

/** Who gets the invite: the attendees and the person who asked, once each, never the sending mailbox itself. */
export const inviteRecipients = (attendees: string[], askerEmail: string, from: string) =>
  [...new Set([...attendees, askerEmail.toLowerCase()].filter((a) => validEmail(a) && a !== from))];

export type InviteMessage = {
  input: InviteInput; organizer: { name: string; email: string }; from: string; people: string[]; starts: Date; ends: Date; tz: string; uid: string; now: Date;
};

/** The whole MIME message: plain text, HTML and the text/calendar REQUEST part, plus the same calendar as invite.ics. Pure, so it can be tested. */
export function buildInviteMime(m: InviteMessage): { mime: string; ics: string; subject: string } {
  const { input, organizer, from, people, starts, ends, tz, uid } = m;
  const event: InviteEvent = { title: input.title, date: input.date, start: input.start, end: input.end, location: input.location, description: input.description, organizerName: organizer.name };
  const { subject, html } = inviteEmail(event, to12h(input.start), to12h(input.end));

  const ics = [
    "BEGIN:VCALENDAR", "PRODID:-//Digiworks//Digi//EN", "VERSION:2.0", "CALSCALE:GREGORIAN", "METHOD:REQUEST",
    "BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${utcStamp(m.now)}`, `DTSTART:${utcStamp(starts)}`, `DTEND:${utcStamp(ends)}`, "SEQUENCE:0", "STATUS:CONFIRMED",
    `SUMMARY:${icsText(input.title)}`,
    ...(input.location ? [`LOCATION:${icsText(input.location)}`] : []),
    `DESCRIPTION:${icsText([input.description, `Invited by ${organizer.name} through Digi.`].filter(Boolean).join("\n\n"))}`,
    // parameter values are quoted, not escaped, and may not contain a double quote
    `ORGANIZER;CN="${organizer.name.replace(/["\r\n]/g, "")} via Digi":mailto:${from}`,
    ...people.map((p) => `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${p}`),
    "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Reminder", "TRIGGER:-PT15M", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].map(fold).join("\r\n") + "\r\n";

  const text = `You're invited to ${input.title} on ${input.date}, ${to12h(input.start)} to ${to12h(input.end)} (${tz}).${input.location ? ` Location: ${input.location}.` : ""} Invited by ${organizer.name}.`;
  const mixed = `mixed_${randomUUID()}`, alt = `alt_${randomUUID()}`;
  const mime = [
    `From: ${header("Campus Events")} <${from}>`, `To: ${people.join(", ")}`, `Subject: ${header(subject)}`, "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixed}"`, "",
    `--${mixed}`, `Content-Type: multipart/alternative; boundary="${alt}"`, "",
    `--${alt}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", b64(text),
    `--${alt}`, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", b64(html),
    `--${alt}`, "Content-Type: text/calendar; charset=UTF-8; method=REQUEST", "Content-Transfer-Encoding: base64", "", b64(ics),
    `--${alt}--`,
    `--${mixed}`, 'Content-Type: application/ics; name="invite.ics"', 'Content-Disposition: attachment; filename="invite.ics"', "Content-Transfer-Encoding: base64", "", b64(ics),
    `--${mixed}--`, "",
  ].join("\r\n");
  return { mime, ics, subject };
}

export async function sendInvite(actor: { id: string; tenantId: string; name: string; email: string }, input: InviteInput) {
  const { starts, ends, tz } = await withTenant(actor.tenantId, async (c) => {
    const zone = ((await c.query("select configuration from tenants where id = $1", [actor.tenantId])).rows[0]?.configuration?.timezone as string) || "America/Chicago";
    const r = (await c.query("select ($1::date + $2::time) at time zone $4 as s, ($1::date + $3::time) at time zone $4 as e", [input.date, input.start, input.end, zone])).rows[0];
    return { starts: new Date(r.s), ends: new Date(r.e), tz: zone };
  });
  const from = mailFrom();
  const people = inviteRecipients(input.attendees, actor.email, from);
  const uid = `${randomUUID()}@digi`;
  const { mime } = buildInviteMime({ input, organizer: { name: actor.name, email: actor.email }, from, people, starts, ends, tz, uid, now: new Date() });
  await sendMime(mime);
  await withTenant(actor.tenantId, (c) => auditEvent(c, { tenantId: actor.tenantId, userId: actor.id, action: "event.invite", entityType: "event", entityId: uid, metadata: { title: input.title, date: input.date, attendees: people.length } }));
  return { sent: true, attendees: people.length };
}
