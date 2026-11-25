import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

const { generateDraft, schedulerApiEnabled, SchedulerError } = await import("@/lib/scheduler-api");

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; delete process.env.SCHEDULER_URL; delete process.env.SCHEDULER_API_KEY; });

function on() { process.env.SCHEDULER_URL = "http://scheduler:8090"; process.env.SCHEDULER_API_KEY = "k"; }

describe("scheduler service client", () => {
  test("off until both the address and the key are set", async () => {
    assert.equal(schedulerApiEnabled(), false);
    await assert.rejects(generateDraft(1, "a@b"), (e: InstanceType<typeof SchedulerError>) => e.status === 503);
  });

  test("sends the key and the starting timetable", async () => {
    on();
    let seen: { url: string; key: string | null; body: unknown } | null = null;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen = { url, key: new Headers(init.headers).get("X-Scheduler-Key"), body: JSON.parse(String(init.body)) };
      return new Response(JSON.stringify({ run_id: 7 }), { status: 200 });
    }) as typeof fetch;
    assert.equal((await generateDraft(3, "reg@newmanu.edu")).run_id, 7);
    assert.deepEqual(seen, { url: "http://scheduler:8090/solve", key: "k", body: { from_run: 3, time_limit: 60, by: "reg@newmanu.edu" } });
  });

  test("the service's own message is passed on, plain or structured", async () => {
    on();
    globalThis.fetch = (async () => new Response(JSON.stringify({ detail: "No timetable 9." }), { status: 404 })) as typeof fetch;
    await assert.rejects(generateDraft(9, "x"), (e: Error & { status: number }) => e.message === "No timetable 9." && e.status === 404);
    globalThis.fetch = (async () => new Response(JSON.stringify({ detail: { message: "Would add problems." } }), { status: 409 })) as typeof fetch;
    await assert.rejects(generateDraft(1, "x"), (e: Error) => e.message === "Would add problems.");
  });

  test("an unreachable service is a plain message, not a crash", async () => {
    on();
    globalThis.fetch = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
    await assert.rejects(generateDraft(1, "x"), (e: Error & { status: number }) => e.message === "The scheduler service can't be reached." && e.status === 502);
  });
});
