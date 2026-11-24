/**
 * The course scheduler service (course-scheduler/service/app.py): runs the solver and the checker. It sits next to the portal on a
 * private network; SCHEDULER_URL is its address and SCHEDULER_API_KEY the shared key it checks. Server side only.
 */
export const schedulerApiEnabled = () => !!process.env.SCHEDULER_URL && !!process.env.SCHEDULER_API_KEY;

export class SchedulerError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export type Summary = { hard: number; real_clashes: number; gaps: number; guessed: number; soft: number; notes: number };
export type Draft = {
  run_id: number; status: string; seconds: number; placed: number; unplaced: { section_id: string; reason: string }[];
  moved_time: string[]; moved_room: string[]; summary: Summary;
};

async function call<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
  if (!schedulerApiEnabled()) throw new SchedulerError("The scheduler service isn't connected.", 503);
  const res = await fetch(new URL(path, process.env.SCHEDULER_URL).toString(), {
    method: "POST", headers: { "Content-Type": "application/json", "X-Scheduler-Key": process.env.SCHEDULER_API_KEY! },
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs), cache: "no-store",
  }).catch((e: Error) => { throw new SchedulerError(e.name === "TimeoutError" ? "The scheduler took too long." : "The scheduler service can't be reached.", 502); });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = (out as { detail?: unknown }).detail;
    throw new SchedulerError(typeof d === "string" ? d : (d as { message?: string })?.message ?? "The scheduler couldn't do that.", res.status);
  }
  return out as T;
}

/** Builds a draft from a timetable; the timetable it starts from is never changed. Takes up to about a minute. */
export const generateDraft = (fromRun: number, by: string) => call<Draft>("/solve", { from_run: fromRun, time_limit: 60, by }, 150_000);
