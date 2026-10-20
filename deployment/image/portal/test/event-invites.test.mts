import assert from "node:assert/strict";
import { describe, test } from "node:test";

const { normalizeInvite, inviteRecipients, buildInviteMime, fold, InviteError } = await import("@/lib/event-invites");

const raw = { title: "Project review", date: "2026-10-25", start: "14:00", end: "15:00", attendees: "priya@x.edu, ravi@x.edu", location: "Library 101", description: "Bring slides" };

describe("checking an invite request", () => {
  test("a good request is normalised: trimmed, 24-hour times, lowercased unique attendees", () => {
    assert.deepEqual(normalizeInvite({ ...raw, title: "  Project review ", start: "2:00 PM", end: "15:00", attendees: "Priya@X.edu; ravi@x.edu priya@x.edu" }), {
      title: "Project review", date: "2026-10-25", start: "14:00", end: "15:00", attendees: ["priya@x.edu", "ravi@x.edu"], location: "Library 101", description: "Bring slides",
    });
  });
  const refused: [string, Partial<typeof raw>, RegExp][] = [
    ["no title", { title: "  " }, /what the event is called/],
    ["end before start", { start: "15:00", end: "14:00" }, /start time before the end time/],
    ["same start and end", { end: "14:00" }, /start time before the end time/],
    ["bad date", { date: "25/10/2026" }, /Give the date/],
    ["no time", { start: "" }, /Give the date/],
    ["a guessed address", { attendees: "ravi, priya@x.edu" }, /not email addresses: ravi\. .*never guess/],
    ["no attendees", { attendees: " , " }, /Say who to invite/],
    ["too many attendees", { attendees: Array.from({ length: 26 }, (_, i) => `p${i}@x.edu`).join(",") }, /at most 25/],
  ];
  for (const [name, change, message] of refused) {
    test(`refused: ${name}`, () => {
      assert.throws(() => normalizeInvite({ ...raw, ...change }), (e: unknown) => e instanceof InviteError && message.test(e.message));
    });
  }
  test("long titles, locations and descriptions are cut to their limits", () => {
    const n = normalizeInvite({ ...raw, title: "t".repeat(300), location: "l".repeat(300), description: "d".repeat(2000) });
    assert.equal(n.title.length, 150);
    assert.equal(n.location.length, 200);
    assert.equal(n.description.length, 1000);
  });
});

describe("recipients", () => {
  test("the asker is invited too, once, and the sending mailbox never invites itself", () => {
    assert.deepEqual(inviteRecipients(["priya@x.edu", "rooms@x.edu"], "Sam@X.edu", "rooms@x.edu"), ["priya@x.edu", "sam@x.edu"]);
    assert.deepEqual(inviteRecipients(["sam@x.edu"], "sam@x.edu", "rooms@x.edu"), ["sam@x.edu"]);
  });
});

/* ---------------------------------------------------------------- the message itself */
const message = (over: Record<string, unknown> = {}) => buildInviteMime({
  input: normalizeInvite(raw), organizer: { name: "Sam Student", email: "sam@x.edu" }, from: "rooms@x.edu", people: ["priya@x.edu", "ravi@x.edu", "sam@x.edu"],
  starts: new Date("2026-10-25T19:00:00Z"), ends: new Date("2026-10-25T20:00:00Z"), tz: "America/Chicago", uid: "u-1@digi", now: new Date("2026-10-20T12:00:00Z"), ...over,
});
/** Undo RFC 5545 line folding so property lines can be read whole. */
const unfold = (ics: string) => ics.replace(/\r\n /g, "");
/** Split a MIME body on a boundary and return the decoded parts with their headers. */
function parts(mime: string, boundary: string) {
  return mime.split(`--${boundary}`).slice(1, -1).map((p) => {
    const [head, ...rest] = p.replace(/^\r\n/, "").split("\r\n\r\n");
    const body = rest.join("\r\n\r\n").trim();
    return { head, body: /base64/.test(head) ? Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8") : body };
  });
}

describe("calendar invite message", () => {
  test("is a meeting REQUEST with the right times (UTC), organiser, attendees and RSVP", () => {
    const ics = unfold(message().ics);
    for (const line of [
      "METHOD:REQUEST", "BEGIN:VEVENT", "UID:u-1@digi", "DTSTAMP:20261020T120000Z", "DTSTART:20261025T190000Z", "DTEND:20261025T200000Z", "SEQUENCE:0",
      "SUMMARY:Project review", "LOCATION:Library 101", 'ORGANIZER;CN="Sam Student via Digi":mailto:rooms@x.edu',
      "ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:priya@x.edu",
      "ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:sam@x.edu", "TRIGGER:-PT15M", "END:VCALENDAR",
    ]) assert.ok(ics.split("\r\n").includes(line), line);
    assert.match(ics, /DESCRIPTION:Bring slides\\n\\nInvited by Sam Student through Digi\./);
  });

  test("commas, semicolons, backslashes and new lines in text are escaped; a quote cannot break the organiser name", () => {
    const ics = unfold(message({ input: normalizeInvite({ ...raw, title: "Review, final; ok \\ done", description: "line1\nline2" }), organizer: { name: 'Sam "The" Student', email: "sam@x.edu" } }).ics);
    assert.ok(ics.includes("SUMMARY:Review\\, final\\; ok \\\\ done"));
    assert.ok(ics.includes("DESCRIPTION:line1\\nline2"));
    assert.ok(ics.includes('ORGANIZER;CN="Sam The Student via Digi":mailto:rooms@x.edu'));
  });

  test("no LOCATION line when no location was given", () => {
    assert.doesNotMatch(message({ input: normalizeInvite({ ...raw, location: "" }) }).ics, /LOCATION:/);
  });

  test("every line is CRLF terminated and at most 75 octets, also with long non-ASCII text", () => {
    const { ics } = message({ input: normalizeInvite({ ...raw, title: "Réunion d'équipe – planification trimestrielle 🎓 ".repeat(3), description: "é".repeat(400) }) });
    assert.ok(ics.endsWith("\r\n"));
    for (const line of ics.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75, `${Buffer.byteLength(line)}: ${line}`);
    assert.doesNotMatch(ics, /[^\r]\n/);
  });

  test("fold never splits a character and keeps the text intact", () => {
    const s = "DESCRIPTION:" + "é🎓a".repeat(50);
    const folded = fold(s);
    assert.equal(folded.replace(/\r\n /g, ""), s);
    for (const l of folded.split("\r\n")) assert.ok(Buffer.byteLength(l) <= 75);
  });

  test("MIME: From is the mailbox, To is everyone, non-ASCII subject is encoded, and it carries text, HTML, calendar and invite.ics", () => {
    const { mime, ics, subject } = message({ input: normalizeInvite({ ...raw, title: "Café review" }) });
    const head = mime.split("\r\n\r\n")[0];
    assert.match(head, /^From: Campus Events <rooms@x\.edu>$/m);
    assert.match(head, /^To: priya@x\.edu, ravi@x\.edu, sam@x\.edu$/m);
    assert.match(head, /^Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/m);
    assert.equal(Buffer.from(head.match(/=\?UTF-8\?B\?(.+)\?=/)![1], "base64").toString("utf8"), subject);
    const mixed = head.match(/boundary="([^"]+)"/)![1];
    const outer = parts(mime, mixed);
    assert.equal(outer.length, 2);
    assert.match(outer[1].head, /application\/ics; name="invite\.ics"/);
    assert.equal(outer[1].body, ics);
    const alt = outer[0].head.match(/boundary="([^"]+)"/)![1];
    const inner = parts(mime, alt);
    assert.deepEqual(inner.map((p) => p.head.match(/Content-Type: ([^;\r\n]+)/)![1]), ["text/plain", "text/html", "text/calendar"]);
    assert.match(inner[2].head, /method=REQUEST/);
    assert.equal(inner[2].body, ics);
    assert.match(inner[0].body, /Café review on 2026-10-25, 2:00 PM to 3:00 PM \(America\/Chicago\)\. Location: Library 101\. Invited by Sam Student\./);
    assert.match(inner[1].body, /Café review/);
  });

  test("base64 bodies are wrapped at 76 characters (mail servers reject longer lines)", () => {
    for (const line of message({ input: normalizeInvite({ ...raw, description: "x".repeat(900) }) }).mime.split("\r\n")) assert.ok(line.length <= 998);
    const b64Lines = message().mime.split("\r\n").filter((l) => /^[A-Za-z0-9+/=]{20,}$/.test(l));
    assert.ok(b64Lines.length > 0);
    for (const l of b64Lines) assert.ok(l.length <= 76, String(l.length));
  });
});
