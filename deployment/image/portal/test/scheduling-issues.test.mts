import assert from "node:assert/strict";
import { describe, test } from "node:test";

const { category, describe: say, group, sectionName, slotLabel } = await import("@/lib/scheduling-issues");

const f = (rule: string, severity: "hard" | "soft" | "note", basis: "real" | "estimated" = "real") =>
  ({ rule, severity, basis, sections: ["2026FA-MUS4083-A"], detail: "", fixes: [] });

describe("course scheduling issues page", () => {
  test("each finding lands in the right place", () => {
    assert.equal(category(f("ROOM_DOUBLE_BOOKED", "hard")), "clash");
    assert.equal(category(f("MISSING_FACULTY", "hard")), "missing");
    assert.equal(category(f("NOT_PLACED", "hard")), "missing");
    assert.equal(category(f("GROUP_OVERLAP", "hard", "estimated")), "guessed");
    assert.equal(category(f("REQUIRED_IN_EVENING", "soft", "estimated")), "guessed");
    assert.equal(category(f("PREFERENCE_MISSED", "soft")), "wish");
    assert.equal(category(f("TAUGHT_TOGETHER", "note")), "practice");
  });

  test("a clash on guessed data is not shown as a real clash", () => {
    assert.equal(category(f("ROOM_TOO_SMALL", "hard", "estimated")), "guessed");
  });

  test("groups keep every category, in order, with counts", () => {
    const g = group([f("ROOM_DOUBLE_BOOKED", "hard"), f("FACULTY_DOUBLE_BOOKED", "hard"), f("FACULTY_DOUBLE_BOOKED", "hard"), f("TAUGHT_TOGETHER", "note")]);
    assert.deepEqual(g.map((x) => [x.value, x.count]), [["clash", 3], ["missing", 0], ["guessed", 0], ["wish", 0], ["practice", 1]]);
    assert.deepEqual(g[0].rules.map((r) => [r.title, r.items.length]), [["Instructor in two places", 2], ["Room double-booked", 1]]);
  });

  test("each finding is one plain sentence, with no internal codes", () => {
    assert.equal(say({ rule: "FACULTY_DOUBLE_BOOKED", detail: "cheek-rachel teaches 2026FA-NSG3072-A (R-1400-1600) and 2026FA-NSG4053-A" }),
      "The same instructor teaches both at overlapping times.");
    assert.equal(say({ rule: "GROUP_OVERLAP", detail: "Nursing BSN: 3000-level required: every section of NSG3072 overlaps every section of NSG4053." }),
      "Nursing BSN: 3000-level required: every section of NSG 3072 overlaps every section of NSG 4053.");
    assert.equal(say({ rule: "REQUIRED_IN_EVENING", detail: "2026FA-CS2003-X is a required course in evening slot M-1800-2000." }),
      "CS 2003 X is a required course in evening slot M-1800-2000.");
  });

  test("section codes and times read like the registrar's", () => {
    assert.equal(sectionName("2026FA-MUS4083-A"), "MUS 4083 A");
    assert.equal(sectionName("2026FA-THEO4023-YA"), "THEO 4023 YA");
    assert.equal(sectionName("odd"), "odd");
    assert.equal(slotLabel("TR", "09:25", "10:40"), "TR 9:25 am to 10:40 am");
    assert.equal(slotLabel("M", "18:00", "20:00"), "M 6:00 pm to 8:00 pm");
    assert.equal(slotLabel("F", "12:00", "12:50"), "F 12:00 pm to 12:50 pm");
  });
});
