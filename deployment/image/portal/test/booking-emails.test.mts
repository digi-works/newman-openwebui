import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { beforeEach, describe, test } from "node:test";
import type { PoolClient } from "pg";
import type { Booking } from "@/lib/bookings";

process.env.DIGI_SECRET_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.BRAND_HOST = "digi.example.edu";
const mod = await import("@/lib/booking-emails");
const { MailError } = await import("@/lib/mail");
const { parseEmails, validEmail, signDecisionLink, verifyDecisionLink, decisionUrl, queueBookingEmail, queueExpiryEmails, sendBookingEmails } = mod;

const TENANT = "11111111-1111-1111-1111-111111111111";
const BOOKING = "22222222-2222-2222-2222-222222222222";

const booking = (over: Partial<Booking> = {}): Booking => ({
  id: BOOKING, ref: "BK-7K2QX", room: "Study Room 101", building: "Library", capacity: 8, features: "", requestedBy: "Sam Student", role: "",
  email: "sam@example.edu", phone: "", personId: "", date: "2026-10-22", start: "2:00 PM", end: "3:00 PM", purpose: "Group study", description: "",
  attendees: 4, needs: [], status: "Tentative", submitted: "2026-10-20", version: 1, ...over,
} as Booking);

describe("email addresses", () => {
  test("parseEmails splits on commas, semicolons and spaces, lowercases and removes duplicates", () => {
    assert.deepEqual(parseEmails(" A@x.edu, b@x.edu;c@x.edu  a@X.edu "), ["a@x.edu", "b@x.edu", "c@x.edu"]);
    assert.deepEqual(parseEmails(""), []);
  });
  test("validEmail accepts real addresses and rejects guesses and junk", () => {
    for (const ok of ["rooms@newmanu.edu", "first.last+tag@sub.example.co.uk"]) assert.equal(validEmail(ok), true, ok);
    for (const bad of ["ravi", "ravi@", "@x.edu", "a@b", "a b@x.edu", "a@x.e", "<a@x.edu>", "a,b@x.edu"]) assert.equal(validEmail(bad), false, bad);
  });
});

describe("approve / reject links", () => {
  test("a signed link verifies and carries tenant, booking, manager and a 14 day expiry", () => {
    const now = Math.floor(Date.now() / 1000);
    const c = verifyDecisionLink(signDecisionLink({ tenantId: TENANT, bookingId: BOOKING, manager: "rooms@x.edu" }));
    assert.ok(c);
    assert.equal(c.tenantId, TENANT);
    assert.equal(c.bookingId, BOOKING);
    assert.equal(c.manager, "rooms@x.edu");
    assert.ok(Math.abs(c.exp - (now + 14 * 86400)) <= 2);
  });
  test("a changed signature is refused", () => {
    const t = signDecisionLink({ tenantId: TENANT, bookingId: BOOKING, manager: "rooms@x.edu" });
    const flipped = t.slice(0, -1) + (t.endsWith("A") ? "B" : "A");
    assert.equal(verifyDecisionLink(flipped), null);
  });
  test("a changed body (another booking or manager) is refused", () => {
    const [, sig] = signDecisionLink({ tenantId: TENANT, bookingId: BOOKING, manager: "rooms@x.edu" }).split(".");
    const forged = Buffer.from(JSON.stringify({ tenantId: TENANT, bookingId: BOOKING, manager: "attacker@x.edu", exp: 9999999999 })).toString("base64url");
    assert.equal(verifyDecisionLink(`${forged}.${sig}`), null);
  });
  test("an expired link is refused even with a valid signature", () => {
    const key = createHmac("sha256", Buffer.from(process.env.DIGI_SECRET_KEY!, "base64")).update("booking-email-link/v1").digest();
    const body = Buffer.from(JSON.stringify({ tenantId: TENANT, bookingId: BOOKING, manager: "rooms@x.edu", exp: Math.floor(Date.now() / 1000) - 1 })).toString("base64url");
    assert.equal(verifyDecisionLink(`${body}.${createHmac("sha256", key).update(body).digest("base64url")}`), null);
  });
  test("a link signed with another server's key is refused", () => {
    const body = Buffer.from(JSON.stringify({ tenantId: TENANT, bookingId: BOOKING, manager: "rooms@x.edu", exp: 9999999999 })).toString("base64url");
    assert.equal(verifyDecisionLink(`${body}.${createHmac("sha256", "other-key").update(body).digest("base64url")}`), null);
  });
  test("malformed tokens are refused without throwing", () => {
    for (const t of ["", "abc", "a.b.c", ".", "not-base64.%%%", `${Buffer.from("not json").toString("base64url")}.x`]) assert.equal(verifyDecisionLink(t), null, t);
  });
  test("decisionUrl points at this site's /email-decision page, PUBLIC_URL first", () => {
    assert.equal(decisionUrl("t.k", "approve"), "https://digi.example.edu/email-decision?t=t.k&d=approve");
    process.env.PUBLIC_URL = "http://localhost:3300/";
    assert.equal(decisionUrl("a+b", "decline"), "http://localhost:3300/email-decision?t=a%2Bb&d=decline");
    delete process.env.PUBLIC_URL;
  });
});

/* A fake database client: answers the settings read, records every other statement. */
function fakeClient(settingsRow: Record<string, unknown> | null) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const c = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rows: sql.includes("from notification_settings") && settingsRow ? [settingsRow] : [], rowCount: 0 };
    },
  } as unknown as PoolClient;
  return { c, calls, inserts: () => calls.filter((x) => x.sql.includes("insert into jobs")) };
}
const ON = { booking_emails_enabled: true, booking_manager_emails: "rooms@x.edu" };
const MAIL_ENV = { MS_TENANT_ID: "t", MS_CLIENT_ID: "c", MS_CLIENT_SECRET: "s", MAIL_FROM: "rooms@x.edu" };

describe("queueing booking emails (inside the booking transaction)", () => {
  beforeEach(() => { for (const k of Object.keys(MAIL_ENV)) delete process.env[k]; });

  test("nothing is queued while email is not set up on the server", async () => {
    const f = fakeClient(ON);
    await queueBookingEmail(f.c, TENANT, "u1", BOOKING, "created");
    assert.equal(f.inserts().length, 0);
  });
  test("nothing is queued while the switch is off, or was never saved and there is no room manager inbox", async () => {
    Object.assign(process.env, MAIL_ENV);
    for (const row of [{ ...ON, booking_emails_enabled: false }, null]) {
      const f = fakeClient(row);
      await queueBookingEmail(f.c, TENANT, "u1", BOOKING, "approved");
      assert.equal(f.inserts().length, 0);
    }
  });
  test("never saved, with email set up and BOOKING_MANAGER_EMAIL: on from the start, so approvals are emailed", async () => {
    Object.assign(process.env, MAIL_ENV, { BOOKING_MANAGER_EMAIL: "rooms@x.edu" });
    const f = fakeClient(null);
    await queueBookingEmail(f.c, TENANT, "u1", BOOKING, "approved");
    assert.equal(f.inserts().length, 1);
    delete process.env.BOOKING_MANAGER_EMAIL;
  });
  test("when on, one job is queued with the booking, kind, actor and a per-booking-and-kind idempotency key", async () => {
    Object.assign(process.env, MAIL_ENV);
    const f = fakeClient(ON);
    await queueBookingEmail(f.c, TENANT, "u1", BOOKING, "declined");
    const [ins] = f.inserts();
    assert.ok(ins);
    assert.match(ins.sql, /on conflict \(tenant_id, idempotency_key\)/);
    assert.deepEqual(ins.params, [TENANT, JSON.stringify({ bookingId: BOOKING, kind: "declined" }), "u1", `booking-email:${BOOKING}:declined`]);
  });
  test("expiry emails are queued for the requests that just expired, as their requester, once each", async () => {
    Object.assign(process.env, MAIL_ENV);
    const f = fakeClient(ON);
    await queueExpiryEmails(f.c, TENANT);
    const [ins] = f.inserts();
    assert.ok(ins);
    assert.match(ins.sql, /b\.requester_user_id/);
    assert.match(ins.sql, /'booking-email:' \|\| b\.id \|\| ':expired'/);
    assert.match(ins.sql, /do nothing/);
  });
  test("BOOKING_MANAGER_EMAIL is the starting manager list until settings are saved; saved settings win", async () => {
    process.env.BOOKING_MANAGER_EMAIL = "Rooms@X.edu, bad, other@x.edu";
    // email is not set up in this test, so the unsaved switch reads as off
    assert.deepEqual(await mod.readSettings(fakeClient(null).c), { bookingEmails: false, managerEmails: ["rooms@x.edu", "other@x.edu"] });
    assert.deepEqual(await mod.readSettings(fakeClient({ ...ON, booking_manager_emails: "a@x.edu; nope" }).c), { bookingEmails: true, managerEmails: ["a@x.edu"] });
    assert.deepEqual(await mod.readSettings(fakeClient({ ...ON, booking_emails_enabled: false }).c), { bookingEmails: false, managerEmails: ["rooms@x.edu"] });
    delete process.env.BOOKING_MANAGER_EMAIL;
  });
});

describe("sending booking emails (the background job)", () => {
  type Sent = { to: string[]; subject: string; html: string };
  const run = async (o: { kind: string; b?: Booking | null; managers?: string[]; on?: boolean; checkpoint?: Record<string, unknown>; fail?: (to: string) => Error | null }) => {
    const sent: Sent[] = [], saves: Record<string, unknown>[] = [];
    const out = await sendBookingEmails(
      { tenantId: TENANT, payload: { bookingId: BOOKING, kind: o.kind }, checkpoint: o.checkpoint ?? {}, save: async (cp) => { saves.push(cp); } },
      {
        settings: async () => ({ bookingEmails: o.on ?? true, managerEmails: o.managers ?? ["rooms@x.edu"] }),
        booking: async () => (o.b === undefined ? booking() : o.b),
        send: async (m) => { const e = o.fail?.(m.to[0]); if (e) throw e; sent.push(m); },
      },
    );
    return { out, sent, saves };
  };

  test("new request: each manager gets Approve and Reject links for this booking, then the requester gets a receipt", async () => {
    const { sent, out } = await run({ kind: "created", managers: ["rooms@x.edu", "deputy@x.edu"] });
    assert.deepEqual(sent.map((m) => m.to[0]), ["rooms@x.edu", "deputy@x.edu", "sam@example.edu"]);
    for (const m of sent.slice(0, 2)) {
      assert.match(m.subject, /^Room booking approval request: Study Room 101/);
      const links = [...m.html.matchAll(/href="([^"]+)"/g)].map((x) => x[1].replace(/&amp;/g, "&"));
      const approve = new URL(links.find((l) => l.endsWith("d=approve"))!), reject = new URL(links.find((l) => l.endsWith("d=decline"))!);
      const claims = verifyDecisionLink(approve.searchParams.get("t")!);
      assert.equal(claims?.bookingId, BOOKING);
      assert.equal(claims?.manager, m.to[0]); // each manager's link names that manager
      assert.equal(reject.searchParams.get("t"), approve.searchParams.get("t"));
    }
    assert.match(sent[2].subject, /^Booking request received/);
    assert.deepEqual(out, { sent: ["manager:rooms@x.edu", "manager:deputy@x.edu", "requester"] });
  });
  test("new request already decided before the job ran: no manager email, the requester still gets the receipt", async () => {
    const { sent } = await run({ kind: "created", b: booking({ status: "Confirmed" }) });
    assert.deepEqual(sent.map((m) => m.to[0]), ["sam@example.edu"]);
  });
  test("new request with no manager inbox set fails permanently (retrying cannot help)", async () => {
    await assert.rejects(run({ kind: "created", managers: [] }), (e: unknown) => e instanceof MailError && e.permanent && /No room manager email/.test(e.message));
  });
  for (const [kind, subject] of [["approved", /^Booking approved/], ["declined", /^Booking request declined/], ["cancelled", /^Booking cancelled/], ["replaced", /^Room request replaced/], ["expired", /^Room request expired/]] as const) {
    test(`${kind}: only the requester is emailed`, async () => {
      const { sent } = await run({ kind });
      assert.equal(sent.length, 1);
      assert.equal(sent[0].to[0], "sam@example.edu");
      assert.match(sent[0].subject, subject);
    });
  }
  test("a retry after a partial failure does not email anyone twice", async () => {
    const first = await run({ kind: "created", managers: ["rooms@x.edu", "deputy@x.edu"], fail: (to) => (to === "deputy@x.edu" ? new Error("network") : null) }).catch((e) => e);
    assert.ok(first instanceof Error);
    const second = await run({ kind: "created", managers: ["rooms@x.edu", "deputy@x.edu"], checkpoint: { sent: ["manager:rooms@x.edu"] } });
    assert.deepEqual(second.sent.map((m) => m.to[0]), ["deputy@x.edu", "sam@example.edu"]);
    assert.deepEqual(second.saves.at(-1), { sent: ["manager:rooms@x.edu", "manager:deputy@x.edu", "requester"] });
  });
  test("switched off after queueing: nothing is sent", async () => {
    const { sent, out } = await run({ kind: "approved", on: false });
    assert.equal(sent.length, 0);
    assert.match(String((out as { skipped: string }).skipped), /switched off/);
  });
  test("a booking that no longer exists: nothing is sent", async () => {
    const { sent } = await run({ kind: "approved", b: null });
    assert.equal(sent.length, 0);
  });
  test("a requester without a valid email address is skipped, not an error", async () => {
    const { sent } = await run({ kind: "approved", b: booking({ email: "unknown" }) });
    assert.equal(sent.length, 0);
  });
  test("an unknown kind fails permanently", async () => {
    await assert.rejects(run({ kind: "teleported" }), (e: unknown) => e instanceof MailError && e.permanent);
  });
});
