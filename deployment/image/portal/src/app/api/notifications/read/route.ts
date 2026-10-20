import { markNotificationsRead } from "@/lib/booking-service";
import { getSessionUser } from "@/lib/session";

export async function POST() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Please sign in again." }, { status: 401 });
  await markNotificationsRead(user);
  return Response.json({ ok: true });
}
