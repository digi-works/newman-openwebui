import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Booking } from "@/lib/bookings";

process.env.BRAND_NAME = "Ask Digi";
process.env.BRAND_ORG = "Newman University";
process.env.BRAND_HOST = "newman.digiworks.ai";
const { managerRequestEmail, requestReceivedEmail, bookingUpdateEmail, inviteEmail } = await import("@/lib/email-templates");

const booking = (over: Partial<Booking> = {}): Booking => ({
  id: "b1", ref: "BK-7K2QX", room: "Study Room 101", building: "Library", capacity: 8, features: "", requestedBy: "Sam Student", role: "",
  email: "sam@example.edu", phone: "", personId: "", date: "2026-10-22", start: "2:00 PM", end: "3:00 PM", purpose: "Group study", description: "",
  attendees: 4, needs: [], status: "Tentative", submitted: "2026-10-20", version: 1, ...over,
} as Booking);
const links = { approve: "https://digi.example.edu/email-decision?t=abc.def&d=approve", reject: "https://digi.example.edu/email-decision?t=abc.def&d=decline" };
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("email templates", () => {
  test("manager email: subject, every booking detail, requester and both buttons", () => {
    const { subject, html } = managerRequestEmail(booking({ needs: ["Projector", "Whiteboard"] }), links);
    assert.equal(subject, "Room booking approval request: Study Room 101 on Thursday, October 22, 2026");
    const t = text(html);
    for (const s of ["BK-7K2QX", "Study Room 101", "Library", "Thursday, October 22, 2026", "2:00 PM – 3:00 PM", "Group study", "Projector, Whiteboard", "Sam Student", "sam@example.edu", "Approve", "Reject", "Newman University"]) assert.ok(t.includes(s), s);
    assert.ok(html.includes('href="https://digi.example.edu/email-decision?t=abc.def&amp;d=approve"'));
    assert.ok(html.includes('href="https://digi.example.edu/email-decision?t=abc.def&amp;d=decline"'));
  });

  test("text from people is escaped everywhere, so a booking cannot inject HTML or links", () => {
    const evil = booking({ purpose: `<script>alert(1)</script>`, requestedBy: `Sam "<b>"`, room: `Room <img src=x onerror=alert(1)>`, needs: [`<a href="http://evil">x</a>`] });
    for (const { html } of [managerRequestEmail(evil, links), requestReceivedEmail(evil), bookingUpdateEmail(evil, "approved")]) {
      assert.doesNotMatch(html, /<script|<img|<a href="http:\/\/evil|<b>/);
      assert.match(html, /&lt;script&gt;/);
    }
    // the decision links themselves cannot break out of the attribute
    const { html } = managerRequestEmail(booking(), { approve: `x" onclick="alert(1)`, reject: "y" });
    assert.doesNotMatch(html, /" onclick="/);
  });

  test("the needs row appears only when there are needs", () => {
    assert.doesNotMatch(text(requestReceivedEmail(booking()).html), /NEEDS|Needs /);
    assert.match(text(requestReceivedEmail(booking({ needs: ["Projector"] })).html), /Needs Projector/i);
  });

  test("request received: subject and what happens next", () => {
    const { subject, html } = requestReceivedEmail(booking());
    assert.equal(subject, "Booking request received: Study Room 101 on Thursday, October 22, 2026");
    assert.match(text(html), /Hi Sam Student/);
    assert.match(text(html), /Awaiting manager approval/);
  });

  const updates = {
    approved: ["Booking approved", "Your booking is approved.", "Approved"],
    declined: ["Booking request declined", "Your request was declined.", "Declined"],
    cancelled: ["Booking cancelled", "Your booking was cancelled.", "Cancelled"],
    replaced: ["Room request replaced", "Your request was replaced.", "Cancelled"],
    expired: ["Room request expired", "Your request expired.", "Expired"],
  } as const;
  for (const [kind, [subject, heading, pill]] of Object.entries(updates)) {
    test(`${kind}: subject, heading and status`, () => {
      const m = bookingUpdateEmail(booking(), kind as keyof typeof updates);
      assert.equal(m.subject, `${subject}: Study Room 101 on Thursday, October 22, 2026`);
      assert.ok(text(m.html).includes(heading));
      assert.ok(text(m.html).includes(pill));
    });
  }

  test("the manager's note is shown on decisions, never on an expiry", () => {
    const b = booking({ decisionNote: "Closed for cleaning" });
    assert.match(text(bookingUpdateEmail(b, "declined").html), /Note Closed for cleaning/i);
    assert.doesNotMatch(text(bookingUpdateEmail(b, "expired").html), /Closed for cleaning/);
  });

  test("an unparseable date is shown as given rather than as 'Invalid Date'", () => {
    assert.match(requestReceivedEmail(booking({ date: "soon" })).subject, /on soon$/);
  });

  test("invite email: subject, details, location and description only when given", () => {
    const e = { title: "Project review", date: "2026-10-25", start: "14:00", end: "15:00", location: "", description: "", organizerName: "Sam Student" };
    const plain = inviteEmail(e, "2:00 PM", "3:00 PM");
    assert.equal(plain.subject, "Invitation: Project review – Sunday, October 25, 2026");
    assert.match(text(plain.html), /2:00 PM – 3:00 PM/);
    assert.doesNotMatch(plain.html, />Location<|>Details</); // the row labels, not the "Event details" heading
    const full = inviteEmail({ ...e, location: "Library 101", description: "Bring slides" }, "2:00 PM", "3:00 PM");
    assert.match(text(full.html), /Library 101/);
    assert.match(text(full.html), /Bring slides/);
  });
});
