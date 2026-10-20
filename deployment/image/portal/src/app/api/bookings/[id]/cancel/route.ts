import { BookingError, cancelBooking } from "@/lib/booking-service";
import { getSessionUser } from "@/lib/session";

const fail = (error: string, status: number) => Response.json({ error }, { status });

/** Cancels a request or booking. A person cancels their own; an approver may cancel any, with a reason. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || user.mustChangePassword) return fail("Please sign in again.", 401);
  let b: { reason?: unknown } = {};
  try { b = await req.json(); } catch { /* no body is fine */ }
  try {
    const booking = await cancelBooking(user, (await ctx.params).id, typeof b.reason === "string" ? b.reason : undefined);
    return Response.json({ booking });
  } catch (e) {
    if (e instanceof BookingError) return fail(e.message, e.status);
    console.error("cancel booking failed", e);
    return fail("Could not cancel.", 502);
  }
}
