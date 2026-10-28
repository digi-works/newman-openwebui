import assert from "node:assert/strict";
import { describe, test } from "node:test";

const { needsAnotherApprover } = await import("@/lib/bookings");

const mine = { email: "Sam@x.edu", requesterUserId: "u1" };
const theirs = { email: "pat@x.edu", requesterUserId: "u2" };
const person = (permissions: string[]) => ({ id: "u1", email: "sam@x.edu", permissions });

describe("deciding your own room request", () => {
  test("an approver without Approve own requests needs someone else", () => {
    assert.equal(needsAnotherApprover(mine, person(["bookings.approve"])), true);
  });

  test("Approve own requests, or the Admin role (*), lets them decide it", () => {
    assert.equal(needsAnotherApprover(mine, person(["bookings.approve", "bookings.approve_own"])), false);
    assert.equal(needsAnotherApprover(mine, person(["*"])), false);
  });

  test("someone else's request is never held back by this rule", () => {
    assert.equal(needsAnotherApprover(theirs, person(["bookings.approve"])), false);
  });

  test("a pre-M4 row with no user id still counts as yours by email", () => {
    assert.equal(needsAnotherApprover({ email: "sam@x.edu" }, person(["bookings.approve"])), true);
  });
});
