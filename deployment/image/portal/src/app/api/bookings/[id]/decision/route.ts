import { BookingError, decideBooking } from "@/lib/booking-service";
import { P } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";

const fail = (error: string, status: number) => Response.json({ error }, { status });

/** Approve or decline a room request. Needs the approve permission, and nobody decides their own request. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requirePermission(P.bookingsApprove);
  if (!user) return fail("You do not have permission to approve or decline requests.", 403);
  const { id } = await ctx.params;
  let body: { decision?: unknown; reason?: unknown; version?: unknown };
  try { body = await req.json(); } catch { return fail("Invalid request.", 400); }
  const { decision, reason, version } = body;
  if (decision !== "approve" && decision !== "decline") return fail("Choose approve or decline.", 400);
  if (typeof reason !== "string" || !reason.trim() || reason.length > 1000) return fail("Add a short reason for this decision.", 400);
  try {
    const booking = await decideBooking(user, id, decision, reason, typeof version === "number" ? version : undefined);
    return Response.json({ ok: true, booking });
  } catch (e) {
    if (e instanceof BookingError) return fail(e.message, e.status);
    console.error("decide booking failed", e);
    return fail("Could not save the decision. Try again in a moment.", 502);
  }
}
