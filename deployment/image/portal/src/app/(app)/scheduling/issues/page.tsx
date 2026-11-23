import { redirect } from "next/navigation";
import { SchedulingIssuesView } from "@/components/scheduling-issues-view";
import { issuesFor, listRuns, schedulingEnabled } from "@/lib/course-scheduling";
import { P } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

type Loaded = Awaited<ReturnType<typeof load>>;

/** The runs, the chosen one and its findings; "error" when the course scheduling database can't be reached. */
async function load(wanted: number) {
  try {
    const runs = await listRuns();
    const run = runs.find((r) => r.id === wanted) ?? runs.find((r) => r.checked) ?? runs[0];
    if (!run) return { state: "empty" as const };
    return { state: "ok" as const, runs, run, ...(await issuesFor(run.id)) };
  } catch (e) {
    console.error("scheduling issues", (e as Error).message);
    return { state: "error" as const };
  }
}

export default async function SchedulingIssuesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermission(P.schedulingView);
  if (!user) redirect("/");
  const data: Loaded | { state: "off" } = schedulingEnabled() ? await load(Number((await searchParams).run)) : { state: "off" };
  return <div className="p-4 md:p-8"><SchedulingIssuesView {...data} /></div>;
}
