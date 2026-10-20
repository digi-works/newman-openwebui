import { redirect } from "next/navigation";
import { RoomRequestForm } from "@/components/room-request-form";
import { getBuildings } from "@/lib/booking-service";
import { NEEDS } from "@/lib/rooms";
import { P } from "@/lib/permissions";
import { authLive, can, getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function NewBookingPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!can(user, P.bookingsCreate)) redirect("/bookings");
  const buildings = authLive() ? await getBuildings(user.tenantId) : [];
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  return (
    <div className="p-4 md:p-8">
      <RoomRequestForm buildings={buildings} needs={[...NEEDS]} today={today} />
    </div>
  );
}
