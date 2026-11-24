import { redirect } from "next/navigation";
import { SchedulingTimetableView } from "@/components/scheduling-timetable-view";
import { listRuns, schedulingEnabled, timetableFor } from "@/lib/course-scheduling";
import { P } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import type { View } from "@/lib/timetable";

export const dynamic = "force-dynamic";

const VIEWS: View[] = ["room", "instructor", "subject", "group"];

async function load(wanted: number, view: View, choice: string | null) {
  try {
    const runs = await listRuns();
    const run = runs.find((r) => r.id === wanted) ?? runs[0];
    if (!run) return { state: "empty" as const };
    return { state: "ok" as const, runs, run, view, choice, ...(await timetableFor(run.id)) };
  } catch (e) {
    console.error("scheduling timetable", (e as Error).message);
    return { state: "error" as const };
  }
}

export default async function SchedulingTimetablePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermission(P.schedulingView);
  if (!user) redirect("/");
  const q = await searchParams;
  const view = VIEWS.includes(q.view as View) ? (q.view as View) : "room";
  const data = schedulingEnabled() ? await load(Number(q.run), view, q.key ?? null) : { state: "off" as const };
  return <div className="p-4 md:p-8"><SchedulingTimetableView {...data} /></div>;
}
