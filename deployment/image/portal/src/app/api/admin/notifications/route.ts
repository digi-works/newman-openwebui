import { getNotificationSettings, parseEmails, saveNotificationSettings, validEmail } from "@/lib/booking-emails";
import { mailConfigured, MailError, mailFrom, sendMail } from "@/lib/mail";
import { P } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";

const fail = (error: string, status: number) => Response.json({ error }, { status });

/** Room booking emails and calendar invites. People who approve room requests manage them. */
export async function GET() {
  const user = await requirePermission(P.bookingsApprove);
  if (!user) return fail("You do not have permission to change this.", 403);
  return Response.json({ settings: await getNotificationSettings(user.tenantId), mail: { configured: mailConfigured(), from: mailFrom() } });
}

export async function PUT(req: Request) {
  const user = await requirePermission(P.bookingsApprove);
  if (!user) return fail("You do not have permission to change this.", 403);
  const b = (await req.json().catch(() => ({}))) as { bookingEmails?: unknown; managerEmails?: unknown; eventInvites?: unknown };
  if (typeof b.bookingEmails !== "boolean" || typeof b.eventInvites !== "boolean" || typeof b.managerEmails !== "string") return fail("Invalid request.", 400);
  const managerEmails = parseEmails(b.managerEmails);
  const bad = managerEmails.filter((e) => !validEmail(e));
  if (bad.length) return fail(`Not an email address: ${bad.join(", ")}`, 400);
  if (managerEmails.length > 10) return fail("Enter at most 10 room manager emails.", 400);
  if (b.bookingEmails && !managerEmails.length) return fail("Enter the room manager email that should receive new requests.", 400);
  if ((b.bookingEmails || b.eventInvites) && !mailConfigured()) return fail("Email is not set up on this server yet, so it cannot be switched on. See the deployment README.", 409);
  const settings = { bookingEmails: b.bookingEmails, managerEmails, eventInvites: b.eventInvites };
  await saveNotificationSettings(user.tenantId, user.id, settings);
  return Response.json({ settings });
}

/** Sends one test email to the person pressing the button, so the Microsoft setup can be checked without bothering anyone else. */
export async function POST() {
  const user = await requirePermission(P.bookingsApprove);
  if (!user) return fail("You do not have permission to change this.", 403);
  if (!mailConfigured()) return fail("Email is not set up on this server yet. See the deployment README.", 409);
  try {
    await sendMail({ to: [user.email], subject: "Digi test email", senderName: "Digi", html: `<p>This is a test from Digi. If you can read it, room booking emails and calendar invites can be sent from ${mailFrom()}.</p>` });
    return Response.json({ ok: true, to: user.email });
  } catch (e) {
    return fail(e instanceof MailError ? e.message : "Could not reach Microsoft. Try again in a moment.", 502);
  }
}
