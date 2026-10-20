# Digi Academics: research notes (Ad Astra, UniTime, blueprint)

Status: research only. No build started. Prepared 4 Oct 2026 from the blueprint
(`DigiWorks_Academic_Planning_Scheduling_Implementation_Blueprint.docx`), the earlier PRD/TDD in Downloads, two Fall 2026
sample spreadsheets, and public sources. Ad Astra internals are proprietary; everything below about Ad Astra is what it
publishes, and much of it is marketing. Treat UniTime facts as documented, Ad Astra facts as claims.

## 1. What the blueprint asks for

Product chain: program strategy, curriculum, multi-year rotation, annual/term plan, section demand, faculty, rooms/times,
student demand/conflicts, approved schedule, actuals, forecast.

| Release | Scope | Exit gate |
|---|---|---|
| R1 | Catalog, programs, curricula, prerequisites; rotation rules; four-year plan; rule traceability; versions, validation, exceptions, override, approval; section baseline vs reduced scenarios; Ask Digi for queries/explanations; synthetic data + import templates | 100% hard-rule compliance, 100% required/capstone protection, explainable exceptions, no automatic publication |
| R2 | Meeting patterns, timeslots, faculty and room constraints, solver assignment, lock/pin, local repair, grid, adjunct minimisation | Feasible, safely editable timetable |
| R3 | Student requests, pathways, conflict matrix, sectioning | Quantified conflicts and progression impact |
| R4 | Registration monitoring, plan vs actual, demand forecasting, faculty capacity, utilisation, annual recommendations | Governed corrective action loop |
| R5 | Exams, events, shared space | |

Guardrails in the blueprint: deterministic rules and solver are the source of truth; the LLM interprets and explains; humans
approve; nothing publishes automatically; every number traceable to a tool response; no direct SQL from the LLM.
Stack proposed: Next.js + shadcn (UI), FastAPI (API), MySQL, OR-Tools CP-SAT behind a solver abstraction, ADRs, golden tests.
Milestones M0-M12; build M0-M3 (foundation, data, rules, four-year plan) before Ask Digi.

Earlier docs in Downloads (`Academic_Scheduling_AI_PRD/TDD.docx`) describe a multi-tenant SaaS with FastAPI + CP-SAT + an LLM that
turns emails into constraint JSON, with a UniTime-inspired schema. They are shorter and earlier than the blueprint, and the TDD
solver snippet is a toy (one boolean per course x room x slot, and a loop variable used outside its scope).

## 2. Ad Astra (public picture)

Company: Ad Astra Information Systems, Overland Park, Kansas, privately held, operating since 1996. Claims 550+ institutions.

Product map (16 named offerings): Essential, Academic, Event and Room Scheduling; Data-Informed Scheduling; Classroom
Optimization; Registration Monitoring; HESI reports (peer benchmarking); Student-Centered Scheduling; Student Demand
Forecasting; Degree Velocity; DFW Analysis; Integrated Planning; Annual Schedule Planning; Faculty Capacity Planning; Pathway
Alignment. It does not include a catalog/curriculum product (competitors point this out).

How it works (as published):
- It sits on top of the SIS. It ingests courses, sections, facilities, faculty and students from the SIS (Banner and Colleague
  named; Jenzabar, Workday and PeopleSoft Campus Solutions listed), recommends, and writes the schedule back. Hosted on AWS.
- Planner loop for scheduling: monitor registrations, model what-if scenarios, preview changes, collaborate with stakeholders,
  implement. Inputs: registration trends, room utilisation, faculty workload, student demographics, local practices.
- Registration Monitoring: fill-rate dashboards by time, modality, location; customisable fill thresholds with alerts (near
  capacity, under-enrolled); in-app comments with tags; a history trail of requested changes and approvals.
- Demand forecasting: machine learning over program pathways, historical enrolment and simulated student populations. Outputs
  high/low demand ranges with plain-language reasoning, compared with planned seats, by completion path, current and future year.
- Annual Schedule Planning: completion paths by campus/modality/timing; pathway health (blocked, clear, unsupported students);
  recommended section counts; guardrails embedded in the existing schedule-building workflow, respecting roles; program-level view
  with financial margin estimates.
- Student-centred outcomes: Degree Velocity (progress beyond credit accumulation), Early Momentum, DFW analysis ("toxic course
  combinations"), alternative meeting patterns for conflict-prone courses.
- Integrated Planning: ties strategy to scheduling guardrails (templates, bottleneck checks, per-program financial thresholds).
- Faculty capacity: hiring forecasts from enrolment; workload views.

Outcome claims (unverified): 4.5M students impacted, $72M financial impact, up to 6% completion gains, 4.9% shorter
time-to-degree, 19% Degree Velocity gain at one college.

User feedback (small sample, Capterra, 4.4/5 on 8 reviews): praised for ease of use, real-time visibility, support; criticised for
slowness on event requests, dense screens with hidden information, hard to find rooms and personal schedules, no Outlook
integration. Competitor claims (Coursedog, biased): Ad Astra lacks dynamic approval workflows, a faculty workload rule builder,
section write-back, and broad SIS write-back; Coursedog sells an all-in-one catalog + curriculum + scheduling platform.

Pages that returned 404 and were not read: Academic Scheduling and Classroom Optimization solution pages. Their detail comes
from the product overview and Data-Informed Scheduling page only.

Reading: Ad Astra's moat is data and analytics wrapped around the SIS schedule (demand ranges, pathway intelligence, benchmarks
across 550 institutions), plus integrations. Its public material says nothing about a multi-year course rotation planner.

## 3. UniTime (documented)

Apereo project, Apache 2.0, Java, 100+ universities, Purdue since 2005. Modules: course timetabling, student scheduling,
examination timetabling, event management, instructor scheduling. The solver, CPSolver, is a separate LGPL library:
iterative forward search over feasible, possibly incomplete assignments; hard constraints hold on whatever is assigned; can
pause/resume; supports minimal perturbation. UniTime-format instances (30 real instances from 10 universities) were the benchmark
for the International Timetabling Competition 2019, and the data is public.

Vocabulary and structure:
- Academic session (term) contains departments, subject areas (each in one department), buildings, rooms, patterns, instructors.
- Instructional offering (course) has one or more configurations; a configuration has scheduling subparts (lecture, lab,
  recitation); a subpart has classes (sections) in a parent-child hierarchy, each with a limit, number of rooms, and date/time patterns.
- Preferences on a class: time, room (and room features/groups/buildings), instructors. Scale: required, strongly preferred,
  preferred, neutral, discouraged, strongly discouraged, prohibited. Required/prohibited are hard; the rest are weights.
- Distribution preferences between classes: same time/days/room, back-to-back, different time, and so on, with the same scale.
- Date patterns (which weeks) and time patterns (weekly slots) combine to form a placement.
- Rooms: building, type, capacity, features, availability, travel times between buildings, sharing between departments.
- Instructors: attributes (qualifications), availability, maximum load, teaching preferences; separate instructor scheduling
  solver assigns instructors after the timetable and student sectioning, per department.
- Curricula and last-like demand: expected student populations (academic area, classification, major) and prior-term enrolment
  produce projected demand that guides sectioning before real registrations exist.
- Reservations: seat counts held for groups (major, cohort), or restrictions that limit access without holding seats.
- Roles/permissions and status types ("Initial Data Load", "Input Data Entry", "Timetabling") gate who can do what in each phase.

Solver lifecycle (a useful template for Digi's governance): load data in Check mode and fix warnings; run Check to prove all hard
constraints can be met (100% of classes assigned) and read conflict statistics for the ones that cannot; switch to Default to
optimise preferences and student conflicts (about 30 minutes typical); run student sectioning; save a named timetable; commit to
publish department-wide (commit can fail if it clashes with another department's committed solution). Interactive mode lets a
scheduler pick an alternative placement from a ranked suggestion list that always keeps every class assigned (minimal
perturbation) and shows the conflicts each choice causes.

Student scheduling: ordered course requests with alternatives and a no-substitute flag; batch sectioning for everyone at once, or
online Scheduling Assistant per student, same constraints. Conflicts are scored: time overlap in proportion to minutes, distance
between locations, lunch gaps under 30 minutes, workday length over 6 hours. Timetable must exist first; sectioning cannot move
class times.

Reports: room allocation by capacity, violated distribution preferences, instructor back-to-back, student conflicts by class pair,
section balancing. CSV/PDF export.

Integration: XML import/export for session setup, rooms, instructors, offerings and timetables, students, course requests and
last-like demand. External IDs mark records owned by another system. Typical sync is once per term or nightly batch; records
without external IDs can be edited directly.

Weak points (inferred, no formal usability study found): classic enterprise UI, steep data-entry and permissions model,
permission errors at Purdue, and nothing on multi-year rotation or AI. A published paper lists the hard parts as fairness across
departments, input-data checking, changing a solution after it is generated, and incomplete demand data.

## 4. How the two compare and where Digi fits

| Question | UniTime | Ad Astra | Digi (blueprint) |
|---|---|---|---|
| Strongest at | Placing classes in time and rooms with student conflicts | Demand, pathways, registration monitoring, benchmarks around an SIS schedule | Multi-year rotation, section allocation, explainable scenarios |
| Multi-year rotation | Not a focus | Not described publicly | Core wedge (R1) |
| Process control | Status types, roles, commit | Roles, comments, history trail | Draft, validate, review, approve, publish, audit |
| Uses data you may not have | Last-like demand, curricula | Pathways, student-level history, simulated populations | Starts with rules and catalog; adds demand in R3/R4 |
| AI | None | "AI" mostly means forecasting and recommendation | Typed tools plus explanation, never the calculator |
| Delivery | Self-hosted Java app | SaaS with SIS integration | Per-customer bundle with SIS-neutral model |

Concept map (UniTime to Digi canonical model): instructional offering -> CourseOffering; scheduling subpart/class -> SectionComponent
+ Section; time/room/instructor preferences -> Preference; distribution preferences -> cross-section Constraint; curricula and
last-like demand -> DemandProjection; solver configuration + timetable + commit -> SolverRun, ScheduleVersion, Publication; interactive
suggestions -> local repair with lock/pin; departments and managers -> organisational scope and permissions.

## 5. Observations for the build

1. The blueprint's R1 sits in a gap neither reference fills publicly. It also needs the least data (catalog, requirements, past
   offerings), which suits a small institution.
2. UniTime's process (check feasibility first, then optimise, then commit) maps directly onto Digi's validate, solve, approve, publish.
   Adopt its three solver modes: Check (feasible?), Optimise, Interactive (local repair).
3. Ad Astra's value is mostly data it has accumulated and the planner workflow around it. Digi cannot copy benchmarks
   (HESI) or its forecasting history on day one, so R4 needs real registration history from the customer.
4. Scale and method: CP-SAT is a good fit for section allocation and faculty/room assignment at small-college size. UniTime's
   search approach is what is proven for very large timetables with student sectioning. The blueprint already plans an
   OR-Tools vs Timefold spike; add UniTime's CPSolver (LGPL, Java) as a reference point and use the ITC 2019 instances as free test data.
5. The portal already has the pieces for Ask Digi tools: an Open WebUI tool calls a private portal API with a shared key, and the
   result renders in chat (the room request flow). The same pattern fits "typed tools only".
6. Governance should be a first-class model from M0: approval state machine, override reasons, audit events, immutable scenario runs.
7. Risks to manage: scope (replace Ad Astra) vs wedge (rotation), dirty SIS data, opaque solver, institution-specific rules hard-coded.

## 6. Sources

- UniTime: https://www.unitime.org/ , https://github.com/UniTime/unitime , https://www.cpsolver.org/ ,
  https://help.unitime.org/manuals/courses-solver , https://help.unitime.org/manuals/student-scheduling ,
  https://help.unitime.org/manuals/administration , https://help.unitime.org/instructor-scheduling ,
  https://www.unitime.org/uct_interfaces.php , https://www.unitime.org/papers/patat22-itc2019.pdf
- Ad Astra: https://www.aais.com/ , /solutions/data-informed-scheduling , /solutions/student-centered-scheduling ,
  /smart-annual-planning , /solutions/enrollment-registration-monitoring , /solutions/predictive-student-demand-forecasting ,
  /solutions/academic-pathway-alignment , /solutions/integrated-planning , /solutions-integrations
- Comparisons: https://www.coursedog.com/company/competitors/ad-astra , https://acops.com/articles/course-demand-forecasting-tools-for-higher-ed-a-closer-look-at-3-major-platforms ,
  https://www.capterra.com/p/126017/Astra-Scheduling/
