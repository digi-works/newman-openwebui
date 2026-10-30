import assert from "node:assert/strict";
import { describe, test } from "node:test";

const { pickBookings } = await import("@/lib/tools/registry");
const { campusDate } = await import("@/lib/campus-time");

const b = (ref: string, date: string, start: string, status = "Confirmed") => ({ ref, date, start, status });
const today = "2026-10-30";
// as listBookings returns them: latest first
const all = [
  b("BK-LATE", "2026-11-05", "9:00 AM"),
  b("BK-PM", "2026-11-01", "2:00 PM"),
  b("BK-AM", "2026-11-01", "10:00 AM", "Tentative"),
  b("BK-WTEVG", "2026-10-27", "10:54 AM", "Tentative"),
  b("BK-OLD", "2026-10-20", "9:00 AM"),
];
const refs = (xs: { ref: string }[]) => xs.map((x) => x.ref);

describe("list_bookings (QA DEF-61)", () => {
  test("a reference is found on any date, in any case, past ones too", () => {
    assert.deepEqual(refs(pickBookings(all, { ref: "bk-wtevg", today })), ["BK-WTEVG"]);
    assert.deepEqual(refs(pickBookings(all, { ref: "BK-OLD", today })), ["BK-OLD"]);
    assert.deepEqual(refs(pickBookings(all, { ref: "BK-NONE", today })), []);
  });

  test("without a date: upcoming ones plus requests still waiting whose day has passed, soonest first", () => {
    assert.deepEqual(refs(pickBookings(all, { today })), ["BK-WTEVG", "BK-AM", "BK-PM", "BK-LATE"]);
  });

  test("a date and a status still narrow it", () => {
    assert.deepEqual(refs(pickBookings(all, { date: "2026-11-01", today })), ["BK-AM", "BK-PM"]);
    assert.deepEqual(refs(pickBookings(all, { status: "tentative", today })), ["BK-WTEVG", "BK-AM"]);
    assert.deepEqual(refs(pickBookings(all, { date: "2026-10-20", today })), ["BK-OLD"]);
  });

  test("today is the campus date, not UTC's", () => {
    // 03:00 UTC on 31 Oct is still 30 Oct in Chicago
    assert.equal(campusDate(new Date("2026-10-31T03:00:00Z")), "2026-10-30");
  });
});
