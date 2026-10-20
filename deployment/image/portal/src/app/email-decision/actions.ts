"use server";

import { redirect } from "next/navigation";
import { managerActor, verifyDecisionLink } from "@/lib/booking-emails";
import { BookingError, decideBooking } from "@/lib/booking-service";
import { hasPermission, P } from "@/lib/permissions";

/** The confirm button on the email decision page. The link is checked again here; the booking rules are applied by decideBooking. */
export async function decideFromEmail(form: FormData) {
  const token = String(form.get("t") ?? "");
  const decision = form.get("decision") === "decline" ? "decline" : "approve";
  const reason = String(form.get("reason") ?? "").trim().slice(0, 1000);
  const back = (q: string) => `/email-decision?t=${encodeURIComponent(token)}&d=${decision}&${q}`;

  const claims = verifyDecisionLink(token);
  if (!claims) redirect(`/email-decision?t=${encodeURIComponent(token)}`);
  if (!reason) redirect(back(`error=${encodeURIComponent(decision === "decline" ? "Add a short reason for declining." : "Add a short note for this decision.")}`));

  const actor = await managerActor(claims.tenantId, claims.manager);
  if (!actor || !hasPermission(actor.permissions, P.bookingsApprove)) {
    redirect(back(`error=${encodeURIComponent(`${claims.manager} needs an active Digi account that can approve room requests. Ask your Digi admin, or decide on the Bookings page.`)}`));
  }
  let message: string;
  try {
    await decideBooking(actor, claims.bookingId, decision, reason);
    message = `done=${decision}`;
  } catch (e) {
    if (!(e instanceof BookingError)) console.error("email decision failed", e);
    message = `error=${encodeURIComponent(e instanceof BookingError ? e.message : "Could not save the decision. Try again in a moment.")}`;
  }
  redirect(back(message));
}
