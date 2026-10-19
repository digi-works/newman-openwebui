import { BookingError, searchAvailable } from "@/lib/booking-service";
import { P } from "@/lib/permissions";
import { getSessionUser, requirePermission } from "@/lib/session";

const fail = (error: string, status: number) => Response.json({ error }, { status });

/** Free rooms for a request, for the Request a room page. */
export async function POST(req: Request) {
  const user = await requirePermission(P.bookingsCreate);
  // an expired session is told to sign in, not that its role is wrong (QA DEF-30)
  if (!user) return (await getSessionUser()) ? fail("Your role cannot request rooms.", 403) : fail("Please sign in again.", 401);
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return fail("Invalid request.", 400); }
  const people = Number(b.people);
  if (!Number.isInteger(people) || people < 1 || people > 1000) return fail("Enter how many people are coming.", 400);
  try {
    return Response.json(await searchAvailable(user.tenantId, {
      date: String(b.date ?? ""), start: String(b.start ?? ""), end: String(b.end ?? ""), people,
      building: typeof b.building === "string" ? b.building : "", needs: Array.isArray(b.needs) ? b.needs.filter((n): n is string => typeof n === "string") : [],
    }));
  } catch (e) {
    if (e instanceof BookingError) return fail(e.message, e.status);
    console.error("room search failed", e);
    return fail("Could not search rooms.", 502);
  }
}
