# Real data report (2026FA)

Loaded by `real/load_real.py` from `2026FA_courses_Mel_8-5-2026.xlsx` (sha256 `eb6a4ee76470`). It replaces the mock data in `course_scheduling`.

## Counts

| Table | Rows | Real or estimated |
|---|---|---|
| `sections` | 563 | Real; `seat_cap` estimated (enrollment rounded up to 5, at least 5) |
| `time_slots` | 118 | Real: every meeting pattern used. `kind` derived: evening from 17:00, lab for 105 minutes or longer |
| `buildings` | 18 | Real codes (names unknown, so the code is the name) |
| `rooms` | 60 | Real; `capacity` (largest section held) and `room_type` (what is taught in it) estimated |
| `faculty` | 159 | Real names; `employment` (9+ credits = full time) and `max_credit_load` estimated |
| `faculty_qualifications` | 425 | Real: each instructor is qualified for what they teach this term |
| `faculty_availability` | 54 | **Mock** (source 'mock'): never blocks a class the person really teaches |
| `corequisite_pairs` | 140 | From the catalog |
| `student_groups` | 74 | Still guessed from program requirements (no student data) |
| `student_group_courses` | 300 | Same |
| `source_sections` | 563 | The file itself, row for row |
| `schedule_runs` / `schedule_assignments` | 1 / 563 | The timetable as run (`solver_version = 'actual-timetable'`) |

## Sections

| | Sections |
|---|---|
| IN_PERSON | 261 |
| ONLINE_ASYNC | 179 |
| ARRANGED | 108 |
| ONLINE_LIVE | 15 |
| part of term `0` | 358 |
| part of term `18` | 91 |
| part of term `28` | 109 |
| part of term `N2` | 5 |

## Rooms by estimated type

| Type | Rooms |
|---|---|
| lecture | 36 |
| off_site | 7 |
| clinical_site | 7 |
| science_lab | 6 |
| nursing_sim | 3 |
| studio | 1 |

## Things to know

- **Two meetings, one kept:** `2026FA-HNRS1004-A` meets M 08:00-08:50 and T 18:00-21:00; a section holds one time slot, so only the first is kept (the full value is in `source_sections`).
- **Subjects with no department in the catalog:** CED, DNAP.
- **Instructor not named ('Staff TBD'):** 37 sections have no instructor; the checker reports them as MISSING_FACULTY.
- **Courses not in the scraped catalog:** 84 (mostly graduate, 5000 and up); their credits come from the last digit of the course number.
- **Meets at a set time but no room named:** `2026FA-BIOL102-1`, `2026FA-CS2003-X`, `2026FA-EDUC3343-V`, `2026FA-ENGL211-1`, `2026FA-NAV1013-J`.
- **Lecture and lab pairs:** 16 lab sections linked to a lecture section of their corequisite course (same section letter when there is one).
