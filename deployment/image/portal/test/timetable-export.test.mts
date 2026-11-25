import assert from "node:assert/strict";
import { describe, test } from "node:test";

const { cell, COLUMNS, fileName, runLabels, termName, toCsv } = await import("@/lib/timetable-export");

const row = (id: string, extra = {}) => ({
  id, course: "ACCT2113", title: "Financial Accounting", days: "TR", start: "09:25", end: "10:40", room: "DEMAT-D242", roomType: "lecture",
  instructor: "J. Carter", enrolled: 21, seats: 25, mode: "IN_PERSON", needsTime: true, half: null, together: null, reason: null, problems: [], ...extra,
});
const title = (r: string) => (r === "ROOM_DOUBLE_BOOKED" ? "Room double-booked" : r);
const lines = (csv: string) => csv.replace(/^﻿/, "").trim().split("\r\n");

describe("timetable download for Excel", () => {
  test("one row per section under a plain header, opening in Excel with accents intact", () => {
    const csv = toCsv([row("2026FA-ACCT2113-B")], null, title);
    assert.ok(csv.startsWith("﻿"));
    const [head, first] = lines(csv);
    assert.equal(head, COLUMNS.join(","));
    assert.equal(first, "ACCT 2113 B,ACCT2113,Financial Accounting,Tue Thu,9:25am,10:40am,DEMAT-D242,J. Carter,21,In person,Whole term,,,");
  });

  test("a draft marks what changed against the timetable it came from", () => {
    const base = new Map([["2026FA-MUS4083-A", { days: "TR", start: "09:25", room: "DEMAT-D275", instructor: "J. Carter" }]]);
    const [, r] = lines(toCsv([row("2026FA-MUS4083-A", { room: "DEMAT-D251", reason: "New room (was DEMAT-D275)." })], base, title));
    assert.ok(r.endsWith(",Yes,New room (was DEMAT-D275).,"));
    const [, same] = lines(toCsv([row("2026FA-MUS4083-A", { room: "DEMAT-D275" })], base, title));
    assert.ok(same.endsWith(",,,"));
  });

  test("real problems are listed; guesses are not", () => {
    const [, r] = lines(toCsv([row("2026FA-THEO1033-B", { problems: [{ rule: "ROOM_DOUBLE_BOOKED", basis: "real" }, { rule: "GROUP_OVERLAP", basis: "estimated" }] })], null, title));
    assert.ok(r.endsWith(",Room double-booked"));
  });

  test("commas and quotes are kept, and no cell can run as a formula", () => {
    assert.equal(cell('Journalism Pract: Beat, "Reporting"'), '"Journalism Pract: Beat, ""Reporting"""');
    assert.equal(cell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
    assert.equal(cell("-5"), "'-5");
    assert.equal(cell(null), "");
  });

  test("timetables have plain names, drafts numbered 1, 2, 3 per term", () => {
    const names = runLabels([
      { id: 1, term: "2026FA", kind: "actual-timetable" }, { id: 2, term: "2026FA", kind: "cpsat-1" },
      { id: 7, term: "2026FA", kind: "edit" }, { id: 5, term: "2027SP", kind: "cpsat-1" },
    ]);
    assert.equal(names.get(1)!.label, "Newman's original (Fall 2026)");
    assert.equal(names.get(2)!.label, "Fixed draft 1 (Fall 2026)");
    assert.equal(names.get(7)!.label, "Edited draft 2 (Fall 2026)");
    assert.equal(names.get(5)!.label, "Fixed draft 1 (Spring 2027)");
    assert.equal(termName("odd"), "odd");
  });

  test("file names say which timetable it is", () => {
    assert.equal(fileName("Newman's original (Fall 2026)"), "Newmans-original-Fall-2026.csv");
    assert.equal(fileName("Fixed draft 1 (Fall 2026)"), "Fixed-draft-1-Fall-2026.csv");
  });
});
