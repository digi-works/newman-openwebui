import assert from "node:assert/strict";
import { describe, test } from "node:test";

const { hasClash, hours, layout, options, pick, subjectOf, time12 } = await import("@/lib/timetable");
const { strictTls } = await import("@/lib/course-scheduling");

type M = Parameters<typeof layout>[0][number];
const m = (id: string, days: string | null, start: string | null, end: string | null, extra: Partial<M> = {}): M => ({
  id, course: id.split("-")[1] ?? id, title: id, days, start, end, room: "R1", roomType: "lecture", instructor: "Pat", enrolled: 10, seats: 10,
  mode: "IN_PERSON", needsTime: !!days, half: null, together: null, reason: null, problems: [], ...extra,
});

describe("timetable week view", () => {
  test("a Tue/Thu class is one block on each day", () => {
    const b = layout([m("2026FA-ACCT2113-B", "TR", "09:25", "10:40")]);
    assert.deepEqual(b.map((x) => [x.day, x.start, x.end, x.lanes]), [["T", 565, 640, 1], ["R", 565, 640, 1]]);
  });

  test("overlapping classes sit side by side, later ones reuse a free lane", () => {
    const b = layout([m("A-X1-A", "M", "09:00", "10:00"), m("A-X2-A", "M", "09:30", "10:30"), m("A-X3-A", "M", "10:15", "11:00")]);
    const lane = Object.fromEntries(b.map((x) => [x.members[0].id, [x.lane, x.lanes]]));
    assert.deepEqual(lane, { "A-X1-A": [0, 2], "A-X2-A": [1, 2], "A-X3-A": [0, 2] });
  });

  test("sections taught together are one block", () => {
    const b = layout([m("2026FA-COMM3103-A", "T", "13:00", "14:15", { together: "TT-4" }), m("2026FA-COMM3113-A", "T", "13:00", "14:15", { together: "TT-4" })]);
    assert.equal(b.length, 1);
    assert.equal(b[0].members.length, 2);
  });

  test("classes with no set time are not on the grid", () => {
    assert.deepEqual(layout([m("2026FA-BIOL4953-A", null, null, null)]), []);
  });

  test("the grid shows at least 8 am to 6 pm, widened to fit", () => {
    assert.deepEqual(hours([]), [480, 1080]);
    assert.deepEqual(hours(layout([m("A-X-A", "R", "06:30", "13:00"), m("A-Y-A", "R", "17:30", "21:30")])), [360, 1320]);
  });

  test("choices by room, instructor, subject and student group", () => {
    const rows = [m("2026FA-ACCT2113-B", "TR", "09:25", "10:40"), m("2026FA-ACCT3033-A", "TR", "10:50", "12:05", { room: "R2", instructor: "Lee" })];
    assert.deepEqual(options(rows, "room", {}).map((o) => [o.value, o.count]), [["R1", 1], ["R2", 1]]);
    assert.deepEqual(options(rows, "subject", {}).map((o) => [o.value, o.count]), [["ACCT", 2]]);
    const groups = { g: { label: "Accounting BS", courses: ["ACCT3033"] } };
    assert.deepEqual(options(rows, "group", groups), [{ value: "g", label: "Accounting BS", count: 1 }]);
    assert.deepEqual(pick(rows, "instructor", "Lee", {}).map((r) => r.id), ["2026FA-ACCT3033-A"]);
    assert.equal(subjectOf("THEO1033"), "THEO");
  });

  test("only real clashes get the red outline, not missing information or guesses", () => {
    assert.equal(hasClash(m("a", "M", "09:00", "10:00", { problems: [{ rule: "ROOM_DOUBLE_BOOKED", basis: "real" }] })), true);
    assert.equal(hasClash(m("a", "M", "09:00", "10:00", { problems: [{ rule: "MISSING_FACULTY", basis: "real" }] })), false);
    assert.equal(hasClash(m("a", "M", "09:00", "10:00", { problems: [{ rule: "GROUP_OVERLAP", basis: "estimated" }] })), false);
  });

  test("times read like a timetable", () => {
    assert.equal(time12("09:25"), "9:25am");
    assert.equal(time12("13:00"), "1:00pm");
    assert.equal(time12("12:00"), "12:00pm");
  });

  test("Neon's sslmode=require becomes verify-full: the same strict check, said outright", () => {
    assert.equal(strictTls("postgresql://u:p@h.neon.tech/db?sslmode=require&channel_binding=require"),
      "postgresql://u:p@h.neon.tech/db?sslmode=verify-full&channel_binding=require");
    assert.equal(strictTls("postgresql://u:p@localhost/db"), "postgresql://u:p@localhost/db");
    assert.equal(strictTls("not a url"), "not a url");
  });
});
