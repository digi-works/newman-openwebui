# Phase 2 use cases: Academic scheduling, the Ad Astra replacement (draft v0.2)

Status: draft for review with Newman. This is the use-case document the scoper requires before solution design and SOW.
Supersedes v0.1 (which assumed section placement and an optional solver; the research shows Ad Astra does room assignment, not solving).
Decision (7 Oct 2026): **Phase 2 is the academic half**: assigning rooms to class-section meetings that arrive from the SIS, with
approval and export back. The event half (non-class room and resource requests) stays as built, plus the changes needed so class
meetings and events share one availability picture. Items marked **[Confirm]** are assumptions to check with Newman.
Background: `adastra-research.md`, `discovery-baseline.md`.

## 1. In scope, out of scope

**In scope**
- Import a term's sections and meeting patterns from the SIS export.
- Show every section meeting as Unassigned, Requested or Scheduled.
- Departments request rooms; the schedule team approves; approved assignments export to the SIS.
- Room search ranked by seat fill and by preference rules.
- Class meetings block rooms for events and vice versa (one availability source).
- Calendar and grid views by room, building, department, instructor and section.
- Roles, audit, notifications in-app.

**Out of scope for Phase 2**
- Choosing which courses or how many sections run, demand forecasting, student sectioning, degree pathways (the parked rotation planner).
- Automatic full-term timetable solving. Section days and times are given by the SIS.
- Writing to the SIS directly (export file first). **[Confirm]** whether Newman's SIS accepts a file or an API.
- Public calendar, registrations, payments, invoicing. **[Confirm]** none are used.

## 2. Terms

- **Section:** a course offering for a term with enrolment cap, instructor and one or more meetings.
- **Section meeting:** a recurring class time (days, start, end, date range) that needs a room. Lecture, lab and recitation are separate meetings.
- **Meeting status:** Unassigned (no room), Requested (department chose a room, awaiting approval), Scheduled (approved), plus Cancelled.
- **Seat fill:** enrolment divided by room capacity. A low fill means a room too big, over 100% means too small.
- **Scheduling authority:** the person or team who may approve rooms in a building or room group.
- **Preference set:** a school-defined set of room filters (building, type, features) for a department or course.

## 3. Personas and roles

| Persona | Needs | Role |
|---|---|---|
| Registrar / schedule team | Own the term, import, approve, export | Schedule Admin |
| Department scheduler | Assign rooms to their department's sections | Dept Scheduler (scoped to department) |
| Room or building owner | Approve use of their rooms (labs, studios, specialty rooms) | Space Approver (scoped) |
| Faculty | See own teaching schedule, flag room needs | Faculty |
| Student | See own class times and rooms (R-later) | Student |
| Dean / Provost office | Read utilisation and exceptions | Read only |

## 4. Use cases

**AC1. Import the term.** Schedule Admin uploads the SIS section export (CSV). Digi validates and shows a reconciliation report (rows read,
kept, rejected with reasons, duplicates, unknown rooms, meetings with no times). Re-import updates changed sections and never silently drops
rows. Rooms already assigned in the SIS arrive as Scheduled or Requested depending on configuration. **[Confirm]** file format and fields.

**AC2. See what needs a room.** Scheduler sees sections filtered by term, department, status (Unassigned, Requested, Scheduled),
meeting type, enrolment and instructor. Counts per status are shown, and Unassigned is the work queue.

**AC3. Find a room for a meeting.** For a section meeting Digi lists rooms that are free for every date of the pattern, fit the cap,
and match the preference set, ranked by seat fill. Unavailable rooms show why (class, event, booking). Rooms that are free for most
dates but clash on some are shown with the clashing dates, not hidden.

**AC4. Request the room.** Scheduler picks a room. The meeting becomes Requested. If the scheduler owns the room (scheduling
authority), it becomes Scheduled directly. Otherwise it goes to the approver for that room.

**AC5. Approve or decline.** Space Approver or Schedule Admin sees the queue with the room, section, conflicts and seat fill, then
approves or declines with a reason. Availability is rechecked at approval, in the same transaction. The proposer cannot approve their
own request when a separate approver exists. **[Confirm]** approval routes per building.

**AC6. Handle conflicts.** A conflict view lists room, instructor and equipment clashes (including class vs class and class vs event).
Hard rules block saving. Overriding a double booking requires a permission, a reason and an expiry, and is audited.

**AC7. Move or change a Scheduled assignment.** Changes after scheduling create a change request with a reason; the approver decides;
the export reflects the change. A section with a changed enrolment cap re-evaluates seat fill and flags rooms that no longer fit.

**AC8. Bulk assign.** Schedule Admin can apply a rule such as "assign all Unassigned lectures under 30 students to the smallest free
room in Science Hall" as a reviewed batch. No batch applies without a preview and confirmation. This is room assignment from a rule,
not a timetable solver.

**AC9. Export to the SIS.** Schedule Admin exports approved room assignments in the format Newman's SIS expects. The export carries
term, version, timestamp, who exported and a content hash, and lists any meetings still Unassigned or Requested. Phase 2 does not write to the SIS.

**AC10. Shared availability.** Room search for events (existing chat and Bookings flow) treats Scheduled and Requested class meetings
as busy. A room with a class meeting never shows free to an event requester.

**AC11. Views.** Calendar and grid by room, building, department, instructor, section. Faculty see only their own classes. Filters mirror
the statuses above. List view exports to CSV.

**AC12. Seat-fill and utilisation reporting.** Per term: rooms by utilisation, sections by seat fill, empty and overfull rooms,
unassigned count. Also the weekly report Newman uses today **[Confirm which]**.

**AC13. Ask Digi.** Typed read tools: "which BIO sections have no room?", "is Science 110 free MWF 10:00?", "why can't section X
go in room Y?". Any proposed assignment returns a pending action the user confirms in the UI. The model never approves.

**AC14. Audit.** Every import, request, approval, decline, override, change and export is logged with actor, time, before and after.

**AC15. Final exam scheduling (later).** Exam meetings as a second meeting set for each section with their own rooms and rules.
**[Confirm]** whether Newman uses Ad Astra for this.

## 5. Rules (starting set, confirm with Newman)

Hard (block): room already used by another class or approved event at an overlapping time on any date in the pattern; enrolment above
room capacity; required room feature missing; room not allowed for this department; room closed or out of service.
Soft (rank or warn): low seat fill (about 65% or higher is typical at other schools); preferred building; instructor back-to-back across
distant buildings; room type not matching meeting type (a lab in a lecture hall).
A check with no data returns "insufficient data", never a pass. Enrolment missing means seat fill is unavailable, not zero.

## 6. Replacement checklist (what "walk away from Ad Astra" means)

Mark each: must have at cutover, can follow, not used today.

- [ ] Import sections from the SIS export (AC1)
- [ ] Department room requests and the approval queue (AC4, AC5)
- [ ] Seat-fill ranked room search (AC3)
- [ ] Conflict detection including events (AC6, AC10)
- [ ] Export approved assignments to the SIS (AC9)
- [ ] Calendar and grid views (AC11)
- [ ] The reports staff run weekly (AC12) **[list them]**
- [ ] Event and room requests still work (existing flow)
- [ ] Final exams (AC15)
- [ ] History of past terms **[how many]**
- [ ] Enrolment-driven features: registration monitoring, fill alerts, forecasting (assumed not part of replacement)

## 7. Data and integration needs

- One real term's SIS section export and the current Ad Astra room assignment output (for parity testing).
- The room list from the SIS and how its room codes map to Digi rooms.
- Department and instructor identifiers, enrolment counts and when they refresh.
- Meeting pattern format (days, times, date ranges, odd weeks, labs).
- Which SIS, its import options, and who owns the integration at Newman.
- Staff identity source for roles.

## 8. Open questions for Newman

1. Which SIS, and can it import room assignments by file? Who owns that process?
2. Who assigns class rooms today, how many people, and who approves?
3. Do departments request rooms or does the registrar assign them all?
4. Which reports and screens are used weekly?
5. Which rooms need special approval (labs, studios, athletics, chapel)?
6. Are exams scheduled in Ad Astra? Public calendar, registrations or payments in use?
7. Contract end date and renewal notice period.
8. How many terms of history must move over?

## 9. Next documents

1. This use-case document reviewed with Newman.
2. Solution design (data model for sections and meetings, availability engine, approval routing, import and export, UI) on
   `docs/platform/architecture-v0.3.md`.
3. SOW and release plan.
