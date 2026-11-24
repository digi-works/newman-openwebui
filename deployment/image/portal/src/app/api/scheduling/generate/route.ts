import { generateDraft, SchedulerError } from "@/lib/scheduler-api";
import { P } from "@/lib/permissions";
import { can, getSessionUser } from "@/lib/session";

export const maxDuration = 180;

/** Generate a draft timetable from another one. Needs "See course scheduling" and "Make timetable drafts". */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || user.mustChangePassword) return Response.json({ error: "Please sign in again." }, { status: 401 });
  if (!can(user, P.schedulingView) || !can(user, P.schedulingManage)) return Response.json({ error: "You can't make timetable drafts." }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { fromRun?: unknown };
  const fromRun = Number(b.fromRun);
  if (!Number.isInteger(fromRun) || fromRun < 1) return Response.json({ error: "Choose a timetable to start from." }, { status: 400 });
  try {
    return Response.json(await generateDraft(fromRun, user.email));
  } catch (e) {
    if (e instanceof SchedulerError) return Response.json({ error: e.message }, { status: e.status >= 500 ? 502 : e.status });
    console.error("generating a draft failed", e);
    return Response.json({ error: "Could not make a draft." }, { status: 502 });
  }
}
