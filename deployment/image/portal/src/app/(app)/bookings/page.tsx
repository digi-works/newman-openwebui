import { BookingsView } from "@/components/bookings-view";
import { listBookings } from "@/lib/booking-service";
import { P } from "@/lib/permissions";
import { authLive, can, getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function BookingsPage() {
  const user = await getSessionUser();
  const viewAll = can(user, P.bookingsViewAll);
  const viewOwn = can(user, P.bookingsViewOwn);

  if (!user || (!viewAll && !viewOwn)) {
    return (
      <div className="p-4 md:p-8">
        <div className="mx-auto max-w-xl rounded-2xl border bg-card p-8 text-center">
          <h1 className="text-xl font-semibold">Bookings</h1>
          <p className="mt-2 text-sm text-muted-foreground">Your role does not include access to bookings. Ask an administrator if you need it.</p>
        </div>
      </div>
    );
  }

  // Without "view all bookings" a person sees only the requests they made (the service enforces it too).
  const bookings = authLive() ? await listBookings(user, viewAll) : [];
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="p-4 md:p-8">
      <BookingsView
        bookings={bookings} today={today} ownOnly={!viewAll} viewer={{ id: user.id, email: user.email }}
        canDecide={can(user, P.bookingsApprove)} canDecideOwn={can(user, P.bookingsApproveOwn)} canEdit={can(user, P.bookingsUpdate)} canCancel={can(user, P.bookingsDelete)} canRequest={can(user, P.bookingsCreate)}
      />
    </div>
  );
}
