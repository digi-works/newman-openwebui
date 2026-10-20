# Ad Astra event scheduling: research notes

Researched 7 Oct 2026. Ad Astra's product is proprietary. This note uses (a) its public marketing pages and (b) university registrar
user guides for **Astra Schedule** (Ad Astra's scheduling application) from Montana State, Drexel, UTRGV, Northwest Missouri State,
Toledo and Texas A&M Corpus Christi. The guides show real behaviour at the screen level, but each school configures Astra differently
(forms, statuses, approval routes), so treat details as typical, not universal. Not reachable: Ad Astra's own help center (403) and
the SMUMN workflow help pages (host did not resolve), so the exact default workflow rules are only known through what the guides say.
Ad Astra's marketing pages for event and room scheduling are cited at the end.

## 1. The data model, as users experience it

- **Event -> Meetings.** An event (title, customer/department, contact, event type) holds one or more **meetings**. Each meeting
  has its own start/end, name, meeting type, max attendance, "requires room" flag, notes, rooms and resources. This is how one
  event covers a recurring series, several dates, or concurrent breakout rooms.
- **Three ways to add meetings:** single; multiple (pick several dates on a calendar, each can have different times, grouped in a
  "meeting group"); recurring (daily/weekly/monthly/yearly, with an end date or a number of occurrences).
- **Two type fields:** *event type* (broad audience, e.g. academic, administrative, campus event, student activity, student
  organization, off-campus) and *meeting type* (finer, one school lists 23).
- **Rooms** carry capacity, type, building/region, **configurations** (the same room as "Classroom" or "Round Tables", shown in
  parentheses) and features. Setup and teardown time between events matters per configuration.
- **Resources** are separate bookable things (AV equipment, furniture, door unlock/lock, custodial), with quantities (several units
  of a projector), and **restrictions** (a resource not allowed in a given room).
- **Customers and contacts:** customer is the department or organization, contact is the person. Generic customers exist for
  "general student use" and "general faculty/staff use".
- **Classes appear as "Sections"** on the same calendars and grids, so a room's availability includes class meetings. Guides warn
  that hiding sections in a filter makes rooms look free when they are not.
- **Scheduling authority:** each room (or building) has an owner who may schedule it directly. Anyone else requests it.

## 2. The user flows

**Requester**
1. Optional: browse the **calendar** (calendar, grid and list views; day/week/month; saved or custom filters) to see what is free.
   Some schools allow a no-login **guest portal** for browsing and requests.
2. **Request Event**, choosing the form for the campus, building group or space type (academic space, non-academic space, student
   union, computer lab, medical school, one-off special forms). Forms differ in required fields and which rooms/resources they show.
3. Fill client and contact info, event details, add meetings, **Assign Rooms** (search filtered by capacity, building, region, "show
   only available rooms"; unavailable shown red, partial conflict on a recurring series shown yellow; multiple rooms per meeting
   allowed), **Assign Resources**, add notes and extras (for example "will dining cater", "featured on campus calendar").
4. **Submit.** Confirmation email goes out. The guides say "this is a request, not a confirmation," with a stated turnaround of
   one to five business days.
5. Later emails say confirmed, declined, or more information needed.

**Scheduler (staff with scheduling authority)**
1. Create events straight from the **scheduling grid** by double-clicking a free slot, or with an Add Event button.
2. Use "Resolve Conflicts" on a recurring series: the system lists the dates that clash so the user can pick another room for just
   those dates. Saving anyway produces a double booking or an Incomplete status.
3. Review a requested event, approve or decline room and resource requests, ask for information, edit, cancel.
4. Send an **event summary** PDF to the requester by email.
5. Search events by keyword or reservation number, quick-view on hover, edit or delete.

**Academic sections (the other half of Ad Astra scheduling)**
- Sections come from the SIS. A department schedules a room for a section: filter by meeting status (all, **unassigned**,
  **requested**), open a section, list available rooms, see **seat fill score** (enrolment vs capacity; one school's rule of thumb
  is about 65% or higher), filter by the school's **preference set**, pick a room. The meeting goes to **Requested**, the schedule
  team approves it, and the **approved room assignment exports back to the SIS** (Banner at that school). Only scheduled meetings
  show to students.

## 3. Statuses and rules seen in the guides

- Meeting/event status: **Scheduled** (all meetings have rooms, nothing awaiting approval), **Incomplete** (a room is missing,
  a room or resource needs approval, a required field is missing, or the event is double-booked by someone without
  double-book permission), plus Tentative, Pending, Cancelled. Section meetings add Unassigned and Requested.
- Approval can sit at the room or resource level, not only the event level.
- Double-booking is blocked by default and permitted only for users with that permission.
- Guardrails schools add: lead time (5 days minimum; request form opens 4 weeks before term; 90-day limit on recurring series),
  start/end times on set grid boundaries (e.g. start on :00 or :30, end on :20 or :50 to keep passing time between classes),
  students need a staff sponsor, after-hours or weekend events need custodial/security services requested, minimum setup/teardown gap.
- Notifications are emails: submitted, approved, declined, info needed. Ad Astra markets in-app notifications and push alerts too.
- Edit rights: users can usually edit and delete only events they created.

## 4. Marketing-level extras (not required for replacement unless Newman uses them)

Public embeddable calendars by category with images and descriptions; public event registration and payments; invoicing and rental
fees (Event Billing add-on); mobile event updates; daily/weekly event and facility usage reports; room utilisation and seat-fill
analytics; final exam scheduling; faculty workload and recommendation in academic scheduling; SIS integrations (Banner, Colleague,
Jenzabar, Workday, PeopleSoft).

## 5. Gap against what Digi has today

Digi today: rooms, buildings, events and bookings in Supabase; requester and approver roles (Admin approves); pending holds a slot
for 7 days; Digi tools `digi_room_request`, `list_rooms`, `list_bookings`; the v0.3 design adds approve/decline in the UI and
pending actions for write tools. Digi bookings are, in effect, **one meeting in one room**.

| Ad Astra capability | Digi today | Gap |
|---|---|---|
| Event with many meetings | One booking = one slot | Event -> Meeting model, recurrence, multiple dates |
| Recurring series with conflict resolution per date | None | Recurrence engine, per-date conflict list and room swap |
| Event types and meeting types, request forms per space type | Single request path | Configurable forms and required fields by space group |
| Room configurations and setup/teardown buffers | Room features only | Configuration per room, buffer rules |
| Resources with quantities and room restrictions | "needs" notes in JSON | Resource catalogue, quantity availability, restrictions |
| Multiple rooms per meeting | One room | Many-to-many |
| Scheduling authority (who may book a room directly) | Admin approves all | Room/building ownership and approvers (planned later as Facilities Approver) |
| Approval at room and resource level | Whole request | Per-line approval, status rollup (Scheduled vs Incomplete) |
| Calendar, grid, list; filters; sections shown with events | List and availability search | Calendar and grid UI, filters, class meetings on the same calendar |
| Double-booking policy and permission | Blocked | Permissioned override with audit |
| Customers/contacts, generic customers | Requester identity | Department as first-class customer |
| Event summary PDF, emails | In-app only (decided) | Optional later, in-app is the current decision |
| Guardrails (lead time, time grid, recurrence limit, sponsor) | 7-day expiry only | Configurable rule set |
| Section room assignment, unassigned/requested/scheduled, seat fill, preference sets, export to SIS | None | Academic half: section import, room assignment workflow, CSV export |
| Public calendar, registrations, billing | None | Out unless Newman uses them |

## 6. What this means for scope

1. **The Event Scheduling build is the event-and-room half of Astra Schedule**, and it should extend the existing rooms and booking
   tables rather than replace them. The big structural change is Event -> Meetings -> Rooms/Resources.
2. **The academic half is room assignment for SIS sections**, not timetable solving: sections arrive with their days and times,
   departments request rooms, a schedule team approves, the result goes back to the SIS. That fits "event scheduling, not course
   optimization" and needs no solver. Confirm with Newman that this is what they use.
3. Seat fill score and preference sets are small, valuable additions (a ranking on the room search), not optimization.
4. Items most likely to decide "can Newman walk away": the SIS import and room-assignment export, the approval routes, and the
   reports they run weekly. These are the questions to put to Newman first.

## Sources

- Ad Astra pages: [Event scheduling](https://www.aais.com/solutions/event-scheduling), [Room scheduling](https://www.aais.com/solutions/room-scheduling-space-management), [Essential scheduling](https://www.aais.com/solutions/essential-scheduling)
- Registrar guides: [Montana State, add an event](https://www.montana.edu/registrar/documents/pdfs/Ad%20Astra%20Schedule%20Add%20Event%208.3.1.pdf), [Drexel, submitting requests](https://drexel.edu/registrar/~/media/Drexel/EMSS-Site-Group/Registrar/Documents/scheduling/Guide-to-Submitting-Requests-through-Astra-Schedule-University-City-Camp.pdf), [UTRGV, event requests](https://www.utrgv.edu/ucentral/_files/documents/as-astra/event-request-manual.pdf), [Northwest Missouri State, event request guide](https://www.nwmissouri.edu/studentaffairs/auxiliary/pdf/ScheduleGuide.pdf), [Toledo, event scheduling](https://www.utoledo.edu/offices/registrar/event_scheduling/), [Texas A&M Corpus Christi, scheduling a course room](https://www.tamucc.edu/academics/registrar/faculty-staff/assets/documents/sop/sop_schedule-a-course-in-astra.pdf)
- Status definitions came from search snippets of Ad Astra's help center and a SMUMN help page, which I could not open directly.
