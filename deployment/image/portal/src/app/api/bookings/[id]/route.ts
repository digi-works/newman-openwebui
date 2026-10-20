import { BookingError, updateBooking } from "@/lib/booking-service";
import { P } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";

const fail = (error: string, status: number) => Response.json({ error }, { status });

/** The requester edits their own request while it is still waiting. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requirePermission(P.bookingsUpdate);
  if (!user) return fail("Your role cannot edit requests.", 403);
  let b: { purpose?: unknown; attendees?: unknown; needs?: unknown };
  try { b = await req.json(); } catch { return fail("Invalid request.", 400); }
  try {
    const booking = await updateBooking(user, (await ctx.params).id, {
      purpose: typeof b.purpose === "string" ? b.purpose : undefined,
      attendees: b.attendees === undefined ? undefined : Number(b.attendees),
      needs: Array.isArray(b.needs) ? b.needs.filter((n): n is string => typeof n === "string") : undefined,
    });
    return Response.json({ booking });
  } catch (e) {
    if (e instanceof BookingError) return fail(e.message, e.status);
    console.error("update booking failed", e);
    return fail("Could not save the change.", 502);
  }
}
