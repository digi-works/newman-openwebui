# Course Scheduler

Gives every section in a term a **time slot**, a **room** and a **faculty member**, so that no student, room or faculty member is
double-booked. A planner reviews and approves the result; the scheduler only proposes.

Plan: `ND-Course Scheduling Agent Design and Approach` and the one-page `ND-Course Scheduler Build Plan` (Confluence, ND space).

## Where we are

| Step | What | State |
|---|---|---|
| 0 | Agree the basics: decisions, data tables, open questions | Done (decisions below still need the manager's yes) |
| 1 | Build the mock data in Neon | **Done**: `mock/build_mock.py`, results in [`mock/REPORT.md`](mock/REPORT.md) |
| 2 | Checker: lists every broken rule in any timetable | Next |
| 3 | Solver: OR-Tools CP-SAT | |
| 4 | Service (API) around the engine | |
| 5 | Real data | |
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

Defined in [`db/001_schema.sql`](db/001_schema.sql) and created in Neon by `mock/build_mock.py`.

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
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
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
