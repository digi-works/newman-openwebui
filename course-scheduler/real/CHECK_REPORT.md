# Checker report: 2026FA, the timetable as run

Written by `scheduler/report.py` from the real data in `course_scheduling`. Section codes and rooms are Newman's; instructor names are left out.

## Summary

| | Count | What it means |
|---|---|---|
| **Real clashes to fix** | **8** | Two classes in one room, or one instructor in two places, on real data |
| Missing information | 42 | 37 sections with no instructor yet (Staff TBD), 5 that meet at a set time with no room |
| Rests on guessed data | 69 | Student groups are guessed from program requirements, so these can't be confirmed until Newman sends degree maps or registration data |
| Wishes not met | 0 | Preferences, not rules |
| Newman practices, not problems | 18 groups taught together (58 sections), 44 clinical overlaps | Recognised by the checker and not counted |

Before the checker knew Newman's practices, the same timetable showed 240 hard findings.

## Real clashes, with checked fixes

Every fix below was applied to the whole timetable and checked: it removes the clash and adds no new hard problem.

| Clash | When | Fixes |
|---|---|---|
| MUS 4083 A and THEO 1033 B both in DEMAT-D275 | TR 9:25 AM-10:40 AM | move MUS 4083 A to DEMAT-D251 (15 seats, estimated); move MUS 4083 A to DEMAT-D185 (25 seats, estimated); move MUS 4083 A to SHH-SH321 (15 seats, estimated) |
| NSG 3002 A and NSG 3093 A both in ECK-EH107 | RF 6:30 AM-1:00 PM / WRFS 6:45 AM-1:00 PM | move NSG 3002 A to ECK-EH254 (10 seats, estimated) |
| NSG 3072 A and NSG 4053 A: same instructor | R 2:00 PM-4:00 PM / R 1:00 PM-4:00 PM | move NSG 4053 A to T 1:00 PM-4:00 PM, same room and instructor; move NSG 4053 A to T 12:00 PM-3:00 PM, same room and instructor; move NSG 4053 A to T 9:00 AM-12:00 PM, same room and instructor |
| DNAP 8045 A and DNAP 8069 A: same instructor | T 10:00 AM-12:00 PM / MTWRF 10:00 AM-12:00 PM | move DNAP 8045 A to M 12:30 PM-2:30 PM, same room and instructor; move DNAP 8045 A to R 1:00 PM-3:00 PM, same room and instructor; move DNAP 8045 A to R 2:00 PM-4:00 PM, same room and instructor |
| NSG 3002 A and NSG 3093 A: same instructor | RF 6:30 AM-1:00 PM / WRFS 6:45 AM-1:00 PM | no free option found: needs a person to decide |
| NSG 3002 A and NSG 3185 A: same instructor | RF 6:30 AM-1:00 PM / R 9:00 AM-12:00 PM | no free option found: needs a person to decide |
| NSG 3093 A and NSG 3185 A: same instructor | WRFS 6:45 AM-1:00 PM / R 9:00 AM-12:00 PM | no free option found: needs a person to decide |
| BSAD 2053 X and EDUC 3133 V: same instructor | R 6:00 PM-8:00 PM / R 5:30 PM-9:30 PM | move BSAD 2053 X to M 6:00 PM-8:00 PM, same room and instructor; move BSAD 2053 X to T 6:00 PM-8:00 PM, same room and instructor; move BSAD 2053 X to M 5:30 PM-7:30 PM, same room and instructor |

## Missing information

### Sections that meet at a set time but have no room

| Section | When | Free rooms that fit |
|---|---|---|
| BIOL 102 1 | MWF 10:00 AM-10:50 AM | BGSC-BG238, DEMAT-JABAR, SHH-SH308 |
| CS 2003 X | M 6:00 PM-8:00 PM | BGSC-BG238, DEMAT-JABAR, SHH-SH308 |
| EDUC 3343 V | M 5:30 PM-9:30 PM | BGSC-BG238, DEMAT-JABAR, SHH-SH308 |
| ENGL 211 1 | TR 9:30 AM-10:45 AM | BGSC-BG238, DEMAT-JABAR, SHH-SH308 |
| NAV 1013 J | MWF 11:00 AM-11:50 AM | DEMAT-D251, SHH-SH321, BGSC-BG121 |

### Sections with no instructor yet (37)

6 of them have at least one instructor who teaches the same course this term and is free then (Ask Digi can propose them).

BIOL 4953 A, BSAD 2113 X, BSAD 2113 Y, BSAD 3073 X, BSAD 3073 Y, BSAD 6500 A, BSAD 6500 B, DSCI 6883 A, ECON 2013 X, EDUC 4035 A, EDUC 4035 B, EDUC 4040 A, EDUC 4045 A, EDUC 4045 B, EDUC 4050 A, EDUC 4055 A, EDUC 4055 B, EDUC 4060 A, EDUC 4065 A, EDUC 4065 B, EDUC 6003 A, GNST 0001 E, GNST 0011 E, GNST 0023 E, HUM 4801 A, MATH 1043 A, PHED 1061 A, SONO 3121 A, SONO 3121 B, SONO 3121 C, SONO 3122 A, SONO 3141 C, SWK 6103 A, SWK 7403 A, SWK 7703 A, THEO 4023 YA, THEO 4883 B

## Rests on guessed data

| Finding | Count |
|---|---|
| GROUP_OVERLAP | 34 |
| REQUIRED_IN_EVENING | 35 |

Student groups are built from each program's required courses by level, not from real student schedules. These findings become real (or disappear) once Newman sends degree maps or registration data.

## Newman practices the checker recognises

- **Taught together** (18 groups): one instructor teaching several sections at one time as one meeting: stacked or cross-listed courses in one room, or one class reaching a partner college or a live online section. Found in the timetable as run and stored in `combined_sections`; a solver keeps only these together.
- **Clinical supervision** (44 overlaps): the instructor of record for a hospital clinical also teaches at that time; students are with hospital staff.
- Both can be switched off (`python -m scheduler.check --strict`) to count them as clashes again.

Groups taught together: 7 in one room, 11 across several sites.
