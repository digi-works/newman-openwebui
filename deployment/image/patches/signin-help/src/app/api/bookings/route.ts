import { BookingError, createBooking } from "@/lib/booking-service";
import { P } from "@/lib/permissions";
import { getSessionUser, requirePermission } from "@/lib/session";

const fail = (error: string, status: number) => Response.json({ error }, { status });

/** Creates a pending room request for the signed-in person. */
export async function POST(req: Request) {
  const user = await requirePermission(P.bookingsCreate);
  // an expired session is told to sign in, not that its role is wrong (QA DEF-30)
  if (!user) return (await getSessionUser()) ? fail("Your role cannot request rooms.", 403) : fail("Please sign in again.", 401);
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return fail("Invalid request.", 400); }
  try {
    const booking = await createBooking(user, {
      roomId: typeof b.roomId === "string" ? b.roomId : undefined, date: String(b.date ?? ""), start: String(b.start ?? ""), end: String(b.end ?? ""),
      purpose: String(b.purpose ?? ""), people: Number(b.people), needs: Array.isArray(b.needs) ? b.needs.filter((n): n is string => typeof n === "string") : [],
    });
    return Response.json({ booking });
  } catch (e) {
    if (e instanceof BookingError) return fail(e.message, e.status);
    console.error("create booking failed", e);
    return fail("Could not save the request. Try again in a moment.", 502);
  }
}
