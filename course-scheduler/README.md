# Course Scheduler

Gives every section in a term a **time slot**, a **room** and a **faculty member**, so that no student, room or faculty member is
double-booked. A planner reviews and approves the result; the scheduler only proposes.

Plan: `ND-Course Scheduling Agent Design and Approach` and the one-page `ND-Course Scheduler Build Plan` (Confluence, ND space).

## Where we are

| Step | What | State |
|---|---|---|
| 0 | Agree the basics: decisions, data tables, open questions | Done (decisions below still need the manager's yes) |
| 1 | Build the mock data in Neon | **Done**: `mock/build_mock.py`, results in [`mock/REPORT.md`](mock/REPORT.md) |
| 2 | Checker: lists every broken rule in any timetable | **Done**: `scheduler/checker.py`, 27 rules, tests in `tests/` |
| A | Checker knows Newman's practices, labels guessed data, suggests checked fixes | **Done**: `scheduler/together.py`, `scheduler/fixes.py`, `scheduler/report.py`; results in [`real/CHECK_REPORT.md`](real/CHECK_REPORT.md) |
| 3 (B) | Solver: OR-Tools CP-SAT | **Done**: `scheduler/solver.py`, `python -m scheduler.solve`; draft run 2 re-plans Fall 2026 with no real clash |
| 4 | Service (API) around the engine | |
| 5 | Real data | **Started**: Fall 2026 sections from the university loaded by `real/load_real.py`, results in [`real/REPORT.md`](real/REPORT.md) |
| 6 | Digi tool (`digi_scheduler`) | |
| 7 | Scheduling screen (Calendar Hero 2.0) | |

## Decisions (step 0)

Each one is our working default until the manager says otherwise.

| # | Decision | Default | Why |
|---|---|---|---|
| D1 | Where the code lives | `course-scheduler/` in this repo, outside the portal image | Same review flow as the rest of Digi; easy to move to its own repo later |
| D2 | Language and solver | Python 3.12, Google OR-Tools CP-SAT, psycopg | CP-SAT is what `docs/academics/architecture.md` already chose |
| D3 | Database | Same Neon database, new schema `course_scheduling`. The scraped catalog in `course_planning` is only read, never changed | Keeps the catalog work intact |
| D4 | First term to schedule | Spring 2027 (`2027SP`). Its section list is built from the Spring 2026 mock pattern (571 sections, 512 in person) | It's the next term to plan |
| D5 | Rooms | Mock. The portal's real rooms come from a Supabase pilot of bookable study rooms, not classrooms, and only exist on the server | A classroom list is needed from the university for step 5 |
| D6 | Faculty assignment | In scope. A section can carry a pre-assigned faculty member (`fixed_faculty_id`) when a chair has already decided | Covers both answers to open question 3 |
| D7 | Student groups | One group per program and course level (1000s, 2000s ...): its required and capstone courses must not overlap. Plus every lecture with its lab | The catalog has no semester-by-semester degree maps |
| D8 | Online and arranged sections | Asynchronous online and `ARRANGED` sections (applied music, athletics, field experience, clinical) get faculty only: no time slot, no room. A live online section gets a time slot but no room | Open question 4 |
| D9 | Time grid | Mon/Wed/Fri 50 min, Tue/Thu 75 min, 3-hour lab blocks, evening blocks; 8:00 to 21:30 | A common US grid until Newman's is known |

## The data tables

Defined in [`db/001_schema.sql`](db/001_schema.sql). Neon now holds the **real Fall 2026 data** (`real/load_real.py`); the mock data can still be
built in memory (`mock/build_mock.py --dry-run`, `scheduler.model.mock_term`). `rooms`, `faculty` and `sections` have an `estimated` column naming
every value that was guessed rather than given.

| Table | Holds | Filled from |
|---|---|---|
| `time_slots` | Every meeting time: days, start, end, kind (lecture, lab, evening) | Mock grid (D9) |
| `buildings`, `rooms` | Room capacity, type (lecture, science lab, computer lab, nursing sim, studio), campus | Mock (D5) |
| `faculty` | Department, full-time or adjunct, maximum credit load | Mock |
| `faculty_qualifications` | Which courses or whole subjects each person can teach | Mock |
| `faculty_availability` | Times someone can't teach (hard rule) or prefers (soft rule) | Mock |
| `sections` | The term's sections: course, seat cap, delivery mode, slot kind, room type needed, linked lecture, pre-assigned faculty | Spring 2026 mock pattern (D4) |
| `corequisite_pairs` | Lecture and lab pairs | Parsed from the catalog's corequisite text |
| `student_groups`, `student_group_courses` | Courses the same students take together | Program requirements by course level (D7) |
| `schedule_runs` | One row per solver run: inputs, settings, status, who approved it | Solver (step 3) |
| `schedule_assignments` | Each section's slot, room, faculty and reason, or why it couldn't be placed | Solver (step 3) |
| `rule_violations` | Every broken rule the checker finds | Checker (step 2) |

What the catalog already gives us (Neon, schema `course_planning`): 1,131 courses (806 schedulable, 40 labs), 72 programs,
1,181 program requirements, 346 prerequisite links, 59 courses with corequisite text.

## Rules

**Hard (must hold):** no overlap inside a student group; a lecture and its lab never overlap; no room or faculty member
double-booked; room capacity at least the seat cap; room type matches; faculty qualified, within load and available.

**Soft (as many as possible):** faculty time preferences; classes spread across the week; fewer building moves; required courses
not in the evening.

## Open questions for the manager

1. Does the university have degree maps or registration data, so student groups can be real instead of D7?
2. Which time grid does Newman use (D9)?
3. Does the scheduler assign faculty, or do chairs assign them first (D6)?
4. Do live online sections need a time slot (D8)?
5. Can we get a classroom list with capacity and type (D5)?

## Setup

```bash
cd course-scheduler
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt   # requirements.txt + pytest
cp .env.example .env        # fill in DATABASE_URL, in quotes; .env is git-ignored, never commit the Neon password
```

## Step 1: mock data

```bash
.venv/bin/python mock/build_mock.py --dry-run   # builds everything in memory, writes mock/REPORT.md, writes nothing to Neon
.venv/bin/python mock/build_mock.py             # creates course_scheduling in Neon and fills it (refuses if it exists)
.venv/bin/python mock/build_mock.py --rebuild   # drops course_scheduling and builds it again (refuses if it holds solver runs)
```

It reads the scraped catalog (`course_planning`) and never changes it. Every random choice uses one seed, so a rebuild gives
identical data. [`mock/REPORT.md`](mock/REPORT.md) lists the counts, the tricky cases, rooms and faculty against demand, and the
rules used to decide how each section meets.

## Step 2: checker

Takes any timetable (a solver run, a planner's edits, or a hand-made file) and lists every broken rule with a plain reason.
Hard rules must never be broken; soft rules are preferences. The full list, with what each means, is `RULES` in
[`scheduler/checker.py`](scheduler/checker.py).

```bash
.venv/bin/python -m scheduler.check --run 3                                  # a saved solver run
.venv/bin/python -m scheduler.check --csv my.csv --term 2027SP               # a file: section_id, slot_id, room_id, faculty_id
.venv/bin/python -m scheduler.check --csv edit.csv --term 2027SP --partial   # only the sections in the file (a planner's edit)
# add --save to store the findings in course_scheduling.rule_violations, --all to print every finding
```

Exit code 0 means no hard rule is broken, 1 means at least one is.

How the student rule works: for each student group, the checker looks for one section of every course that fits in a clash-free
week. If every section of one course overlaps every section of another, it reports `GROUP_OVERLAP` for that pair; if each pair is
fine but no full combination exists, it reports `GROUP_NO_COMBINATION`.

**Proof it works:**
- `tests/test_checker.py` (no database): a clean timetable gives no findings, and breaking each rule on its own gives exactly that rule.
- `.venv/bin/python -m scheduler.demo` writes [`mock/bad_timetable.csv`](mock/bad_timetable.csv): 21 sections from the mock data with
  15 rules broken on purpose (the `broken_on_purpose` column). `tests/test_bad_timetable_db.py` checks every one is caught; it is
  skipped when there is no `DATABASE_URL`.

```bash
.venv/bin/python -m pytest -q tests
```

## Real data: Fall 2026

The university sent its Fall 2026 section list (`2026FA_courses_Mel_8-5-2026.xlsx`, one row per section). It replaces the mock data in Neon.
The file holds instructor names and enrollment, so it stays out of git; pass its path to the loader.

```bash
.venv/bin/python real/load_real.py ~/Downloads/2026FA_courses_Mel_8-5-2026.xlsx --dry-run   # parse it and write real/REPORT.md only
.venv/bin/python real/load_real.py ~/Downloads/2026FA_courses_Mel_8-5-2026.xlsx --rebuild   # drop course_scheduling and load it
.venv/bin/python -m scheduler.check --run 1                                                # score the timetable as the university ran it
```

| From the file (real) | Estimated from the file (named in `estimated`) | Still not real |
|---|---|---|
| Sections, meeting days and times, rooms, instructors, enrollment, online or in person, part of term and dates | Seat caps, room capacity and type, instructor employment and maximum load, which lecture a lab belongs to | Student groups (guessed from program requirements); instructor availability (mock, `source = 'mock'`, fitted so it never blocks a class the person really teaches) |

`source_sections` keeps the file row for row. The timetable as run is schedule run 1 (`solver_version = 'actual-timetable'`).
Sections in different parts of the term (first and second 8 weeks) never clash. Partner colleges and hospitals are whole sites, not single rooms,
so they are never double-booked.

**What the checker says about the real timetable** (run 1): see [`real/CHECK_REPORT.md`](real/CHECK_REPORT.md). In short: 8 real clashes
(2 room, 6 instructor), each with checked fixes where one exists; 42 gaps in the data (37 sections with no instructor, 5 with no room);
69 findings that rest on guessed student groups; and the Newman practices below, which are notes, not problems. Before step A the same
timetable showed 240 hard findings. The one true room clash: `MUS 4083 A` and `THEO 1033 B`, both Tue/Thu 9:25 in `DEMAT D275`.

## Step A: Newman's practices, guessed data and fixes

The checker now tells real problems apart from how Newman works and from gaps in our data.

| | What | Where |
|---|---|---|
| Taught together | One instructor teaching several sections at one time as one meeting: stacked or cross-listed courses in one room, or one class reaching a partner college or a live online section. Found in the timetable as run (`together.infer`) and stored in `combined_sections` (source `inferred`; the registrar can add more). Only sections listed there may share an instructor and a room at the same time, and only at the same time slot with the same instructor; their credits count once. Reported as the note `TAUGHT_TOGETHER`. | `scheduler/together.py`, `checker.Practices` |
| Clinical supervision | A hospital clinical doesn't block its instructor of record (students are with hospital staff). Reported as the note `CLINICAL_SUPERVISION`. | `checker.Practices` |
| Guessed data | Every finding has `basis`: `estimated` when it rests on a guess (room size or type, seat cap, student groups, mock availability, maximum load), otherwise `real`. | `checker.Violation.basis` |
| Fixes | For room clashes, missing rooms, rooms that don't fit, instructor clashes, a lab over its lecture and missing instructors: free rooms, free times or free qualified instructors. Each fix is applied to the whole timetable and checked before it is offered: it must remove the finding and add no new hard finding. Nothing is changed. | `scheduler/fixes.py` |
| Report | A plain-words report with no instructor names, safe to share. | `scheduler/report.py` |

```bash
.venv/bin/python -m scheduler.check --run 1 --fixes           # findings with checked fixes
.venv/bin/python -m scheduler.check --run 1 --strict          # count taught-together and clinical overlaps as clashes again
.venv/bin/python -m scheduler.check --run 1 --save            # store findings, basis and fixes in rule_violations (for the Issues screen)
.venv/bin/python -m scheduler.report --run 1                  # writes real/CHECK_REPORT.md
```

## Step B: the solver

`scheduler/solver.py` (Google OR-Tools CP-SAT) gives every section that meets at a set time a time slot and a room. Instructors are kept
as given (a chair chose them). It starts from a timetable, normally the one the university ran, and changes as little as it can.

| | How |
|---|---|
| Hard (never broken) | No room or instructor double-booked (in the same weeks of the term); room of the right type and big enough; a lab never over its lecture; never at a time the instructor can't teach |
| Kept | Each section's meeting pattern (days per week, minutes per meeting); sections taught together move as one class, in one room that holds them all; partner colleges and hospitals keep their time and site |
| Soft (costs) | Changing a section's time (10) or room (3); a required course in the evening (2); outside an instructor's preferred times (1); two single-section required courses of one guessed student group overlapping (4) |
| Can't fit | Left unplaced with a plain reason, never forced (cost 1000) |

Every draft is then checked by the checker, and with `--save` stored as a new run (`solver_version = 'cpsat-1'`, `plan_status = 'draft'`)
with its findings and fixes, so it shows on Scheduling > Issues next to the timetable as run. The base run is never changed.

```bash
.venv/bin/python -m scheduler.solve --from-run 1            # re-plan the timetable as run
.venv/bin/python -m scheduler.solve --from-run 1 --fresh    # build from the same meeting patterns, keeping only instructors
.venv/bin/python -m scheduler.solve --from-run 1 --save     # store it as a draft run
```

**On the real Fall 2026 data** (about 4 seconds, proven optimal): 0 room or instructor clashes, 3 sections moved to another time and 7 to
another room (the 5 that had no room got one), 2 not placed with a reason (a nursing sim lab that only one room can hold at that time, and
an evening class whose instructor has no other free evening in the mock availability). `--fresh` also gives 0 clashes, moving about 170 sections.
What the solver can't fix is data: 37 sections with no instructor, and the guessed student groups.

After changing `db/001_schema.sql`, reload with `real/load_real.py ... --rebuild`: it recreates the schema and fills `combined_sections`.
