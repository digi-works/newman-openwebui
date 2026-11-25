import { exportCsv, schedulingEnabled } from "@/lib/course-scheduling";
import { P } from "@/lib/permissions";
import { can, getSessionUser } from "@/lib/session";

/** Download one timetable (a draft, or the one as run) as a CSV file that opens in Excel. Needs "See course scheduling". */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || user.mustChangePassword) return Response.json({ error: "Please sign in again." }, { status: 401 });
  if (!can(user, P.schedulingView)) return Response.json({ error: "You can't see course scheduling." }, { status: 403 });
  if (!schedulingEnabled()) return Response.json({ error: "Course scheduling isn't connected." }, { status: 503 });
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "No such timetable." }, { status: 404 });
  try {
    const out = await exportCsv(id);
    if (!out) return Response.json({ error: "No such timetable." }, { status: 404 });
    return new Response(out.csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${out.name}"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    console.error("timetable export failed", (e as Error).message);
    return Response.json({ error: "Could not make the file." }, { status: 502 });
  }
}
