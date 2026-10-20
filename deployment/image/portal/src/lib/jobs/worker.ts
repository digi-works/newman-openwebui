import "./handlers";
import { scheduleRetention } from "../retention";
import { checkForUpdates } from "../stack/installer";
import { runOne } from "./engine";

/**
 * Runs the job loop inside the portal process. Several processes can run it at once: jobs are claimed with a lease (FOR UPDATE SKIP LOCKED),
 * so no job is worked twice. Turn it off with JOB_WORKER=off (for example for a process that only serves pages).
 */
const g = globalThis as { __digiJobWorker?: boolean };
const POLL_MS = Number(process.env.JOB_POLL_MS) || 2000;
const LOOPS = Number(process.env.JOB_WORKER_LOOPS) || 2;

export function startJobWorker() {
  if (g.__digiJobWorker || process.env.JOB_WORKER === "off") return;
  g.__digiJobWorker = true;
  // Once an hour (and at start) make sure today's retention sweep is queued for every tenant; the job engine runs it.
  void (async () => {
    await new Promise((r) => setTimeout(r, 5000));
    for (;;) {
      try { await scheduleRetention(); } catch (e) { console.error("scheduling retention failed", (e as Error).message); }
      await new Promise((r) => setTimeout(r, 3_600_000));
    }
  })();
  // Once an hour, ask the platform for revocations and updates (does nothing until this stack is enrolled; never blocks the app).
  void (async () => {
    await new Promise((r) => setTimeout(r, 20_000));
    for (;;) {
      try { await checkForUpdates(); } catch (e) { console.error("update check failed", (e as Error).message); }
      await new Promise((r) => setTimeout(r, Number(process.env.RELEASE_CHECK_MS) || 3_600_000));
    }
  })();
  for (let i = 0; i < LOOPS; i++) {
    void (async () => {
      await new Promise((r) => setTimeout(r, 1000 + i * 250));
      for (;;) {
        let did = false;
        try { did = await runOne(); } catch (e) { console.error("job worker error", (e as Error).message); }
        if (!did) await new Promise((r) => setTimeout(r, POLL_MS));
      }
    })();
  }
}
