/**
 * Booking types shared by the service, the API and the pages. Rules and data live in booking-service.ts and Digi's database.
 * Until M4 this file held sample data and a Supabase reader; both are gone.
 */
export type BookingStatus = "Tentative" | "Confirmed" | "Declined" | "Cancelled" | "Expired";

export type Booking = {
  id: string;
  /** Reference shown to people, e.g. BK-7K2QX */
  ref: string;
  room: string;
  building: string;
  capacity: number;
  features: string;
  requestedBy: string;
  role: string;
  email: string;
  phone: string;
  personId: string;
  /** Local date of the booking in the university's time zone, e.g. 2026-10-14 */
  date: string;
  start: string;
  end: string;
  purpose: string;
  description: string;
  attendees: number;
  needs: string[];
  status: BookingStatus;
  /** Local date the request was submitted */
  submitted: string;
  decisionNote?: string;
  /** Bumped on every change. A decision sent with a stale version is refused. */
  version: number;
  /** The person who made the request, when they are a Digi user */
  requesterUserId?: string;
  /** When a waiting request expires if nobody decides (ISO), only while it is waiting */
  expiresAt?: string;
};

/** True when the booking was requested by this person: by user id, or by email for rows copied from before M4. */
export const isOwnBooking = (b: Pick<Booking, "email" | "requesterUserId">, user: { id: string; email: string }) =>
  (b.requesterUserId ? b.requesterUserId === user.id : false) || b.email.trim().toLowerCase() === user.email.trim().toLowerCase();
