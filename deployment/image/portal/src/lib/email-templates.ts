import { getBrand } from "./brand";
import type { Booking } from "./bookings";

/**
 * The HTML of every email Digi sends, in the campus look of the earlier Newman templates (navy and maroon, serif headings, a details table).
 * Inline styles only, because mail clients drop style sheets. Every value is escaped here; callers pass plain text.
 */
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

const NAVY = "#071D49", MAROON = "#9E2A2F", MUTED = "#8A93A3", TEXT = "#3A4357", LINE = "#ECECEA";
const SERIF = "Georgia, 'Times New Roman', serif";
const PILL = {
  waiting: "background:#FBF0DC;color:#8A6100;border:1px solid #F0DFB5;",
  good: "background:#E6F4EA;color:#1E6B34;border:1px solid #BFE3C9;",
  bad: "background:#FBE9EA;color:#9E2A2F;border:1px solid #F0C4C6;",
};

function shell(o: { title: string; kicker: string; heading: string; greeting: string; intro: string; pill?: { text: string; tone: keyof typeof PILL }; body: string; signoff: string }) {
  const brand = getBrand();
  const pill = o.pill ? `<div style="margin:22px 0 0;"><span style="display:inline-block;${PILL[o.pill.tone]}border-radius:8px;padding:6px 14px;font-size:13px;font-weight:600;">${esc(o.pill.text)}</span></div>` : "";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="color-scheme" content="light only"><title>${esc(o.title)}</title></head>
<body style="margin:0;padding:0;background:#F3F3F1;">
<div style="background:#F3F3F1;padding:32px 12px;font-family:Arial, Helvetica, sans-serif;color:${NAVY};">
<div style="max-width:600px;margin:0 auto;background:#FFFFFF;border:1px solid #E6E6E3;border-radius:16px;overflow:hidden;">
<div style="padding:20px 36px;border-bottom:1px solid ${LINE};">
<div style="font-family:${SERIF};font-size:17px;font-weight:700;letter-spacing:.12em;color:${NAVY};text-transform:uppercase;">${esc(brand.org)}</div>
<div style="font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:${MUTED};margin-top:4px;">${esc(brand.name)}</div>
</div>
<div style="padding:38px 36px 0;">
<div style="font-size:11px;font-weight:500;letter-spacing:.2em;text-transform:uppercase;color:${MUTED};"><span style="color:${MAROON};">&#9679;</span>&nbsp; ${esc(o.kicker)}</div>
<h1 style="margin:14px 0 0;font-family:${SERIF};font-size:30px;line-height:1.2;font-weight:400;color:${NAVY};">${esc(o.heading)}</h1>
<p style="margin:18px 0 0;font-size:15px;line-height:1.7;color:${TEXT};">${esc(o.greeting)}</p>
<p style="margin:8px 0 0;font-size:15px;line-height:1.7;color:${TEXT};">${esc(o.intro)}</p>
${pill}
</div>
${o.body}
<div style="padding:30px 36px 36px;"><p style="margin:0;font-size:14px;line-height:1.7;color:${TEXT};">Best regards,<br><span style="font-weight:600;color:${NAVY};">${esc(o.signoff)}</span><br><span style="font-size:12px;color:${MUTED};">${esc(brand.org)} &middot; ${esc(brand.name)}</span></p></div>
</div>
<div style="max-width:600px;margin:0 auto;padding:20px 12px 0;text-align:center;font-size:11.5px;line-height:1.7;color:${MUTED};">This is an automated message from ${esc(brand.name)}. Please do not reply to this email.<br>${esc(brand.host)}</div>
</div></body></html>`;
}

const section = (inner: string, top = 30) => `<div style="padding:${top}px 36px 0;">${inner}</div>`;

function table(title: string, rows: [string, string][]) {
  const tr = rows.map(([k, v], i) => {
    const border = i === 0 ? "0" : `1px solid ${LINE}`;
    return `<tr><td style="padding:13px 16px 13px 0;border-top:${border};width:36%;vertical-align:top;font-size:10.5px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:${MUTED};line-height:1.9;">${esc(k)}</td><td style="padding:13px 0;border-top:${border};vertical-align:top;font-size:15px;line-height:1.5;color:${NAVY};">${esc(v)}</td></tr>`;
  }).join("");
  return section(`<div style="font-size:14px;font-weight:600;color:${NAVY};padding-bottom:8px;">${esc(title)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-top:1px solid ${LINE};border-bottom:1px solid ${LINE};">${tr}</table>`);
}

const refBox = (ref: string, note: string) => section(
  `<div style="background:#F7F8FA;border:1px solid ${LINE};border-radius:12px;padding:16px 20px;"><div style="font-size:10.5px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:${MUTED};">Reference</div><div style="margin-top:6px;font-family:${SERIF};font-size:22px;letter-spacing:.04em;color:${NAVY};">${esc(ref)}</div><div style="margin-top:6px;font-size:12.5px;line-height:1.5;color:#5A6474;">${esc(note)}</div></div>`, 28);

const paragraph = (title: string, text: string) => section(`<div style="font-size:14px;font-weight:600;color:${NAVY};">${esc(title)}</div><p style="margin:8px 0 0;font-size:15px;line-height:1.7;color:${TEXT};">${esc(text)}</p>`);

const prettyDate = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
};

const bookingRows = (b: Booking): [string, string][] => [
  ["Room", b.room], ["Building", b.building], ["Date", prettyDate(b.date)], ["Time", `${b.start} – ${b.end}`],
  ["Attendees", String(b.attendees)], ["Purpose", b.purpose], ...(b.needs.length ? [["Needs", b.needs.join(", ")] as [string, string]] : []),
];
const when = (b: Booking) => `${b.room} on ${prettyDate(b.date)}`;

/** To the room manager: a new request, with Approve and Reject buttons that open a confirmation page in Digi. */
export function managerRequestEmail(b: Booking, links: { approve: string; reject: string }) {
  const button = (href: string, label: string, primary: boolean) =>
    `<a href="${esc(href)}" style="display:inline-block;background:${primary ? NAVY : "#FFFFFF"};color:${primary ? "#FFFFFF" : MAROON};text-decoration:none;padding:13px 34px;border:1px solid ${primary ? NAVY : "#E7C3C5"};border-radius:10px;font-size:14px;font-weight:600;margin:4px 6px;">${label}</a>`;
  const html = shell({
    title: "Room booking request", kicker: "Room booking · Action required", heading: "A room request needs your decision.",
    greeting: "Hello,", intro: `${b.requestedBy} has requested a room and it is waiting for your decision.`, pill: { text: "Awaiting your approval", tone: "waiting" },
    body: refBox(b.ref, "Requested through Digi.") + table("Booking details", bookingRows(b)) + table("Requested by", [["Name", b.requestedBy], ["Email", b.email]])
      + section(`<div style="text-align:center;">${button(links.approve, "Approve", true)}${button(links.reject, "Reject", false)}<p style="margin:16px 0 0;font-size:12.5px;line-height:1.6;color:#5A6474;">Each button opens a page in Digi where you confirm your decision. You can also decide on the Bookings page.</p></div>`, 32),
    signoff: "Room Booking Assistant",
  });
  return { subject: `Room booking approval request: ${when(b)}`, html };
}

/** To the requester, right after they asked. */
export function requestReceivedEmail(b: Booking) {
  const html = shell({
    title: "Room booking", kicker: "Room booking · Request received", heading: "Your request is in.",
    greeting: `Hi ${b.requestedBy},`, intro: "Thank you for your room booking request. It has been received and is waiting for review.", pill: { text: "Awaiting manager approval", tone: "waiting" },
    body: refBox(b.ref, "Keep this reference. You will need it to check on your request.") + table("Booking details", bookingRows(b))
      + paragraph("What happens next", "The room manager will review your request. You will get another email once a decision has been made. No further action is needed now."),
    signoff: "Room Booking Assistant",
  });
  return { subject: `Booking request received: ${when(b)}`, html };
}

export type BookingUpdate = "approved" | "declined" | "cancelled" | "replaced" | "expired";

const UPDATE: Record<BookingUpdate, { subject: string; heading: string; intro: string; pill: string; tone: keyof typeof PILL; next: string }> = {
  approved: { subject: "Booking approved", heading: "Your booking is approved.", intro: "Good news: your room booking request has been approved.", pill: "Approved", tone: "good", next: "The room is yours for this time. Please keep this email for your records." },
  declined: { subject: "Booking request declined", heading: "Your request was declined.", intro: "Thank you for your room booking request. Unfortunately it could not be approved.", pill: "Declined", tone: "bad", next: "You are welcome to request a different time or room." },
  cancelled: { subject: "Booking cancelled", heading: "Your booking was cancelled.", intro: "Your room booking has been cancelled by the room manager.", pill: "Cancelled", tone: "bad", next: "You are welcome to request a different time or room." },
  replaced: { subject: "Room request replaced", heading: "Your request was replaced.", intro: "The room you requested was given to a priority request, so your request has been cancelled.", pill: "Cancelled", tone: "bad", next: "You are welcome to request a different time or room." },
  expired: { subject: "Room request expired", heading: "Your request expired.", intro: "No decision was made on your room request in time, so it has expired and the room is free again.", pill: "Expired", tone: "bad", next: "You can request the room again if you still need it." },
};

/** To the requester when their request or booking changes. */
export function bookingUpdateEmail(b: Booking, kind: BookingUpdate) {
  const u = UPDATE[kind];
  const rows = bookingRows(b);
  if (b.decisionNote && kind !== "expired") rows.push(["Note", b.decisionNote]);
  const html = shell({
    title: "Room booking", kicker: "Room booking · Update", heading: u.heading, greeting: `Hi ${b.requestedBy},`, intro: u.intro, pill: { text: u.pill, tone: u.tone },
    body: refBox(b.ref, "Quote this reference if you contact the room manager about this booking.") + table("Booking details", rows) + paragraph("Good to know", u.next),
    signoff: "Room Booking Assistant",
  });
  return { subject: `${u.subject}: ${when(b)}`, html };
}

export type InviteEvent = { title: string; date: string; start: string; end: string; location: string; description: string; organizerName: string };

/** The HTML part of a calendar invite. The calendar part (Yes / No / Maybe) is added by the sender. */
export function inviteEmail(e: InviteEvent, startLabel: string, endLabel: string) {
  const rows: [string, string][] = [["Event", e.title], ["Date", prettyDate(e.date)], ["Time", `${startLabel} – ${endLabel}`]];
  if (e.location) rows.push(["Location", e.location]);
  if (e.description) rows.push(["Details", e.description]);
  rows.push(["Invited by", e.organizerName]);
  const html = shell({
    title: "Event invitation", kicker: "Events · Invitation", heading: "You're invited.", greeting: "Hi there,",
    intro: `You're invited to ${e.title} on ${prettyDate(e.date)}. Use the Yes, Maybe or No buttons in your calendar to reply.`,
    body: table("Event details", rows), signoff: "Campus Events Assistant",
  });
  return { subject: `Invitation: ${e.title} – ${prettyDate(e.date)}`, html };
}

/** To someone who asked for a new password on /forgot-password. The link works once, for `minutes`. */
export function passwordResetEmail(name: string, url: string, minutes: number) {
  const brand = getBrand();
  const button = `<a href="${esc(url)}" style="display:inline-block;background:${NAVY};color:#FFFFFF;text-decoration:none;padding:13px 34px;border:1px solid ${NAVY};border-radius:10px;font-size:14px;font-weight:600;">Choose a new password</a>`;
  const html = shell({
    title: "Reset your password", kicker: "Account · Password reset", heading: "Choose a new password.",
    greeting: `Hi ${name},`, intro: `Someone, hopefully you, asked to reset the password of your ${brand.name} account. The button below works once, for the next ${minutes} minutes.`,
    body: section(`<div style="text-align:center;">${button}</div>`, 28)
      + paragraph("Did not ask for this?", "Ignore this email. Your password stays as it is, and the link stops working on its own."),
    signoff: brand.name,
  });
  return { subject: `Reset your ${brand.name} password`, html };
}
