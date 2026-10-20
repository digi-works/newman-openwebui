# Event Scheduling discovery baseline: Digi today vs Ad Astra

Prepared 7 Oct 2026 as the starting point for discovery with Newman. "Digi today" is read from the portal code and the live Supabase
schema (restricted `portal_app` role), not from assumptions. "Ad Astra" is from public pages and registrar guides
(`adastra-research.md`), so it is typical behaviour, not Newman's configuration. Status key: **Have** (works today), **Partial**,
**Data only** (stored but no workflow), **Missing**, **Unknown** (needs Newman).

## 1. What Digi has today

**Data (Supabase, synthetic):** `buildings` (10), `rooms` (43: type, capacity, features JSON, reservable, searchable, access notes),
`events` (12) with `event_occurences` (19: event, sequence, date, start/end time, room, status, cancelled), and
`room_booking_details` (17 requests). A `courses` table exists but the portal role cannot read it and it is empty.
Note the correction to the earlier gap table: **an Event -> Occurrence structure already exists in the data** (an event such as
"Fall Welcome Week Mixer" or "Finals study hours" has dated occurrences with rooms). The portal can only read it. There is no screen
or API that creates, edits or cancels events. Bookings are a separate table, one row = one room and one date and time window.

**Workflow (portal and Ask Digi):**
- A requester (via the Digi chat tool) picks a date, time, headcount and needs, Digi searches free rooms, submits a request that is
  stored as `pending`.
- Room search treats approved/pending bookings and scheduled event occurrences as busy, widens its filters in steps and says what it
  loosened. The create step re-checks for a clash under a database lock.
- Admin approves or declines with a note on the Bookings page (UI only). States: pending, approved, declined. A pending request
  holds the slot; the 7-day expiry is decided but not built in the code I read.
- In-app notification bell. No email.
- Bookings page lists requests with status. No calendar, grid or day view.

## 2. Non-academic events: Digi vs Ad Astra

| Capability | Ad Astra (typical) | Digi today | Status |
|---|---|---|---|
| Room catalogue with capacity, type, features | Yes, plus configurations | Yes, no configurations | Partial |
| Buildings | Yes | Yes | Have |
| Request a room (date, time, headcount, needs) | Event request wizard with forms per space type | One conversational request, one slot | Partial |
| Event holding several meetings | Yes | Event -> occurrences exist in data, not creatable | Data only |
| Recurring series (daily/weekly/monthly/yearly) | Yes, with per-date conflict list | No | Missing |
| Multiple rooms for one meeting | Yes | One room | Missing |
| Resources (AV, furniture, doors, custodial) with quantity | Yes | Free-text "needs" in JSON, no availability | Missing |
| Event type and meeting type | Yes | Event `type` text on catalogue events only | Partial |
| Forms and required fields per space type | Yes | No | Missing |
| Conflict check | Yes, blocks double booking | Yes (rooms, bookings and event occurrences) | Have |
| Double-book override by permission | Yes | No | Missing |
| Setup/teardown buffers | Yes | No | Missing |
| Approval | Event, room and resource level, scheduling authority per room | Admin approves whole request | Partial |
| Statuses | Scheduled, Incomplete, Tentative, Pending, Cancelled | pending, approved, declined | Partial |
| Notifications | Email at each step, summary PDF | In-app only (a decided choice) | Partial |
| Calendar, grid, list, filters | Yes, classes shown with events | List and chat search only | Missing |
| Create or edit directly on the grid (staff) | Yes | No | Missing |
| Edit or cancel own request | Own events only | No cancel or edit route (only the admin decision route exists) | Missing |
| Guardrails (lead time, time grid, series limit, sponsor) | School-configured | Only the 7-day hold (decided) | Missing |
| Audit trail | History of requested changes and approvals | `audit_events` table in the new foundation (0001), not wired to bookings | Partial |
| Public calendar, registrations, payments, invoicing | Marketed add-ons | None | Missing (Unknown if Newman uses) |
| Reports (daily/weekly event and facility usage) | Yes | None | Missing |

## 3. Academic events (class sections): Digi vs Ad Astra

| Capability | Ad Astra (typical) | Digi today | Status |
|---|---|---|---|
| Sections imported from the SIS with days and times | Yes (Banner, Colleague, Jenzabar, Workday, PeopleSoft) | None. `courses` table is empty and unreadable | Missing |
| Section list by status: unassigned, requested, scheduled | Yes | None | Missing |
| Department requests a room for a section meeting | Yes | None | Missing |
| Room list ranked by seat fill (enrolment vs capacity) | Yes | Room search sorts by smallest fitting capacity, which is similar in spirit | Partial |
| Room preferences per school (preference sets) | Yes | Filters by building and needs | Partial |
| Schedule team approval of room assignments | Yes | Bookings approval exists for events only | Partial |
| Approved assignments export back to the SIS | Yes | None | Missing |
| Classes visible on the same calendar as events | Yes | Not applicable, no sections | Missing |
| Room availability counts class meetings | Yes | Only because there are no classes | Missing |
| Final exam scheduling | Marketed | None | Missing |
| Faculty assignment, workload views | Marketed | None | Out of scope for Phase 2 |

## 4. The two halves, summarised

| | Event half | Academic half |
|---|---|---|
| Digi coverage today | About a third of the request-and-approve flow works for a single room and slot | Nothing beyond room data |
| Biggest structural gap | Event -> Meeting -> Room/Resource model, recurrence, calendar UI | Section data from the SIS and the export back |
| Biggest unknown | Which add-ons Newman uses (billing, registrations, public calendar) | Whether Newman uses this half, and which SIS |
| Risk | Medium, mostly our own build | High, depends on SIS access and data quality |

## 5. Discovery agenda (what to ask and look at, in order)

1. **Confirm the academic half.** Do departments assign class rooms in Ad Astra and push them to the SIS? Which SIS?
2. **Watch a scheduler work.** One real event request and one real section room assignment, start to finish. Record the screens.
3. **Get artifacts.** One term's section export, Ad Astra's room assignment output, the event request forms (fields), the list of
   event types and meeting types, room configurations and resource list.
4. **Approval map.** Who approves which rooms and resources, and the rules for double-booking and after-hours.
5. **Weekly reports and screens.** What staff open every week, and what they would miss first.
6. **Add-ons check.** Public calendar, registrations, payments, invoicing, exams, email notifications.
7. **Contract.** End date and notice period (sets the real deadline).
8. **Identity.** Staff, faculty and student sign-in source, and who may see class schedules.

## 6. Reuse for the build

- Reuse: rooms, buildings, events and occurrences tables, the conflict check pattern (lock, then range overlap on bookings and
  occurrences), the approve/decline UI, the in-app notifications, Ask Digi room tools, the foundation `audit_events` and tenant model.
- Change: the portal role is read-only on events and occurrences, so event creation needs new grants and tables, applied by SQL
  files you run (the MCP connection to Supabase is read-only and not authorised this session).
- Add: recurrence, resources, multi-room, per-line approval and status rollup, calendar and grid views, section import and
  room-assignment workflow, CSV export.
