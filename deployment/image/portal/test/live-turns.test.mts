import assert from "node:assert/strict";
import { describe, test } from "node:test";

const { trackTurn, stopTurn } = await import("@/lib/live-turns");

/** A turn shaped like the one /api/chat registers: it takes a stop until it starts saving. */
function fakeTurn(userId: string) {
  const t = { shown: undefined as number | undefined, saving: false, markSaved: () => {} };
  const saved = new Promise<void>((r) => { t.markSaved = r; });
  const untrack = trackTurn("m1", { userId, saved, stop: (n) => { if (t.saving) return false; t.shown = n; return true; } });
  return { t, untrack };
}

describe("stopping a running answer (DEF-50)", () => {
  test("a running turn takes the stop and learns how much the person saw", async () => {
    const { t, untrack } = fakeTurn("u1");
    assert.equal(await stopTurn("m1", "u1", 42), "stopped");
    assert.equal(t.shown, 42);
    untrack();
  });

  test("someone else cannot stop it", async () => {
    const { t, untrack } = fakeTurn("u1");
    assert.equal(await stopTurn("m1", "u2", 0), "ended");
    assert.equal(t.shown, undefined);
    untrack();
  });

  test("a stop that lands while the answer is being saved waits for the save, so the caller can cut the saved message", async () => {
    const { t, untrack } = fakeTurn("u1");
    t.saving = true;
    let settled = false;
    const p = stopTurn("m1", "u1", 5).then((r) => { settled = true; return r; });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(settled, false);
    t.markSaved();
    untrack();
    assert.equal(await p, "ended");
  });

  test("with no running turn the saved message is final", async () => {
    assert.equal(await stopTurn("nope", "u1", 0), "ended");
  });
});
