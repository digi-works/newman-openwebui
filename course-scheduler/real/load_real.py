"""Loads the university's real section list (an Excel export, one row per section) into course_scheduling, replacing the mock data.

What the file gives is stored as given: sections, meeting days and times, rooms, instructors, enrollment, part of term, dates.
What it doesn't give is estimated from it, and every estimated column is named in that row's `estimated` column:
seat caps, room capacity and type, instructor employment and maximum load, which lecture a lab belongs to.
Student groups are still built from the catalog's program requirements (source 'mock_level'): the file has no student data.
The timetable as the university ran it is saved as one schedule run (solver_version 'actual-timetable'), so the checker can score it.

    .venv/bin/python real/load_real.py ~/Downloads/2026FA_courses_Mel_8-5-2026.xlsx --dry-run   # parse and write real/REPORT.md only
    .venv/bin/python real/load_real.py ~/Downloads/2026FA_courses_Mel_8-5-2026.xlsx --rebuild   # drop course_scheduling and load the file

Never changes course_planning. Refuses to drop course_scheduling if it holds solver runs other than an actual timetable.
"""
import hashlib, math, pathlib, random, re, sys
from collections import Counter, defaultdict
from datetime import datetime, time

import openpyxl
import psycopg

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT / "mock"))
from build_mock import database_url, how_it_meets   # noqa: E402  (same room-type rules as the mock, same .env handling)

TERM_CODES = {10: "FA", 20: "SP", 30: "SU"}
CAMPUS = {"NU": "Wichita", "OLN": "Online", None: "Unknown"}
CLASSROOM_BUILDINGS = {"BGSC", "DEMAT", "ECK", "SHH"}                      # Newman's own classroom buildings in this file
CLINICAL_SITES = {"VCSF", "VCSJ", "VCST", "WMC", "KHC", "RJDVA", "WIN"}   # hospital placements (Radiologic Technology clinicals)
NO_ROOM = {"ONLIN", "TBA"}                                                # Zoom, or not decided yet
ACTUAL = "actual-timetable"


def clean(v):
    if v is None: return None
    if isinstance(v, str):
        v = re.sub(r"\s+", " ", v).strip()
        return None if v in ("", "NULL", "None") else v
    return v


def as_time(v):
    if isinstance(v, time): return v
    return datetime.strptime(v.strip(), "%I:%M %p").time()


def meetings(r):
    """[(days, start, end)] from the three ALL_* columns; several meetings are separated by ';'."""
    days_raw = r["ALL_DAYS"] if isinstance(r["ALL_DAYS"], str) else ""
    if not days_raw.strip() or clean(r["ALL_BEGIN_TIMES"]) is None: return []
    begins = r["ALL_BEGIN_TIMES"].split(";") if isinstance(r["ALL_BEGIN_TIMES"], str) else [r["ALL_BEGIN_TIMES"]]
    ends = r["ALL_END_TIMES"].split(";") if isinstance(r["ALL_END_TIMES"], str) else [r["ALL_END_TIMES"]]
    days = days_raw.split(";")
    assert len(begins) == len(ends) == len(days), r["CRS_CDE"]
    return [(re.sub(r"\s", "", d), as_time(b), as_time(e)) for d, b, e in zip(days, begins, ends)]


def slot_of(days, start, end):
    mins = (end.hour * 60 + end.minute) - (start.hour * 60 + start.minute)
    kind = "evening" if start >= time(17) else "lab" if mins >= 105 else "lecture"
    return (f"{days}-{start:%H%M}-{end:%H%M}", days, start, end, kind)


def slug(last, first):
    return re.sub(r"[^a-z0-9]+", "-", f"{last} {first}".lower()).strip("-")


def round5(n): return max(5, int(math.ceil(n / 5.0) * 5))


def read_file(path):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    rows = list(wb.worksheets[0].iter_rows(values_only=True))
    head = rows[0]
    return [dict(zip(head, r)) for r in rows[1:] if any(c not in (None, "") for c in r)]


def build(cur, path):
    raw = read_file(path)
    terms = {(r["YR_CDE"], r["TRM_CDE"]) for r in raw}
    assert len(terms) == 1, f"the file holds more than one term: {terms}"
    (yr, trm), = terms
    term = f"{yr}{TERM_CODES[int(trm)]}"

    courses = {r[0]: dict(zip(["course_id", "subject", "title", "department_id", "credits", "course_level", "is_lab", "coreq"], r))
               for r in cur.execute("select course_id, subject, title, department_id, credits, course_level, is_lab, corequisite_text from course_planning.courses")}
    dept_of_subject = dict(cur.execute("select code, department_id from course_planning.departments").fetchall())
    programs = {r[0]: r[1:] for r in cur.execute("select program_id, name, degree_type from course_planning.programs")}
    reqs = cur.execute("select program_id, course_id, requirement_type from course_planning.program_requirements where requirement_type in ('REQUIRED', 'CAPSTONE')").fetchall()
    rng = random.Random(0)   # how_it_meets only uses it for online sections, which we never pass it
    notes, source = [], []

    # ---- one record per section ----
    secs = []
    for r in raw:
        subject, number, code = clean(r["CRS_CDE"]).split(" ")
        course_id = subject + number
        title = clean(f"{r['CRS_TITLE'] or ''}{(r['CRS_TITLE_2'] or '').rstrip() if clean(r['CRS_TITLE_2']) else ''}")
        last, first = clean(r["LAST_NAME"]), clean(r["FIRST_NAME"])
        teacher = None if (last, first) == ("Staff", "TBD") or not last else (slug(last, first), f"{first} {last}")
        meets = meetings(r)
        loc, bld, room = clean(r["LOCATION"]), clean(r["BUILDING"]), clean(r["ROOM"])
        sid = f"{term}-{course_id}-{code}"
        if len(meets) > 1:
            notes.append(f"**Two meetings, one kept:** `{sid}` meets " + " and ".join(f"{d} {s:%H:%M}-{e:%H:%M}" for d, s, e in meets)
                         + "; a section holds one time slot, so only the first is kept (the full value is in `source_sections`).")
        cat = courses.get(course_id)
        credits = int(cat["credits"]) if cat else int(number[-1])
        online = loc == "OLN" or bld == "ONLIN"
        room_id = None if online or bld is None or bld in NO_ROOM else f"{bld}-{room}" if room != bld else bld
        if loc not in ("NU", "OLN", None) and room_id: room_kind = "off_site"
        elif bld in CLINICAL_SITES: room_kind = "clinical_site"
        elif room_id and bld not in CLASSROOM_BUILDINGS: room_kind = "off_site"
        else: room_kind = None   # a campus classroom: type estimated from what is taught in it, below
        if online: delivery = "ONLINE_LIVE" if meets else "ONLINE_ASYNC"
        elif not meets: delivery = "ARRANGED"
        else: delivery = "IN_PERSON"
        slot = slot_of(*meets[0]) if meets else None
        enrolled = int(r["CRS_ENROLLMENT"] or 0)
        secs.append(dict(section_id=sid, course_id=course_id, subject=subject, section_code=code, title=title, credits=credits,
                         enrolled=enrolled, seat_cap=round5(enrolled), delivery_mode=delivery, campus=CAMPUS.get(loc, loc),
                         slot=slot if delivery in ("IN_PERSON", "ONLINE_LIVE") else None,
                         room_id=room_id if delivery == "IN_PERSON" else None, room_kind=room_kind, building=bld, teacher=teacher,
                         subterm=clean(str(r["SUBTERM_CDE"])), first_date=r["FIRST_BEGIN_DTE"].date(), last_date=r["LAST_END_DTE"].date(),
                         in_catalog=cat is not None, estimated=["seat_cap"]))
        source.append((term, sid, pathlib.Path(path).name, clean(str(r["SUBTERM_CDE"])), clean(r["INSTITUT_DIV_CDE"]), title,
                       teacher[1] if teacher else None, enrolled, r["FIRST_BEGIN_DTE"].date(), r["LAST_END_DTE"].date(), loc, bld, room,
                       "; ".join(f"{s:%H:%M}" for _, s, _ in meets) or None, "; ".join(f"{e:%H:%M}" for _, _, e in meets) or None,
                       "; ".join(d for d, _, _ in meets) or None))
    ids = Counter(s["section_id"] for s in secs)
    assert max(ids.values()) == 1, [k for k, n in ids.items() if n > 1]

    # ---- rooms: real ids; capacity and type estimated from the sections held in them ----
    room_secs = defaultdict(list)
    for s in secs:
        if s["room_id"]: room_secs[s["room_id"]].append(s)
    rooms, buildings = [], {}
    for rid, ss in sorted(room_secs.items()):
        kind = ss[0]["room_kind"]
        if kind is None:
            votes = Counter()
            for s in ss:
                c = courses.get(s["course_id"])
                votes[how_it_meets(c, "IN_PERSON", rng)[2] if c else "lecture"] += 1
            votes.pop(None, None)
            kind = sorted(votes.items(), key=lambda kv: (-kv[1], kv[0] != "lecture", kv[0]))[0][0] if votes else "lecture"
        cap = max(s["seat_cap"] for s in ss)
        rooms.append((rid, ss[0]["building"], cap, kind, ["capacity", "room_type"]))
        buildings.setdefault(ss[0]["building"], ss[0]["campus"])
        for s in ss:
            s["required_room_type"] = kind; s["estimated"].append("required_room_type")
    for s in secs:
        s.setdefault("required_room_type", None)
        if s["delivery_mode"] == "IN_PERSON" and not s["room_id"]:   # meets at a set time, but the file names no room
            s["required_room_type"] = "lecture"; s["estimated"].append("required_room_type")
        s["slot_kind"] = ("lab" if s["slot"][4] == "lab" else "lecture") if s["slot"] else None

    # ---- time slots: every meeting pattern actually used ----
    slots = sorted({s["slot"] for s in secs if s["slot"]})

    # ---- instructors: real names and assignments; employment and maximum load estimated ----
    by_teacher = defaultdict(list)
    for s in secs:
        if s["teacher"]: by_teacher[s["teacher"]].append(s)
    faculty, quals = [], set()
    for (fid, name), ss in sorted(by_teacher.items()):
        load = sum(s["credits"] for s in ss)
        depts = Counter(dept_of_subject[s["subject"]] for s in ss if s["subject"] in dept_of_subject)
        dept = sorted(depts.items(), key=lambda kv: (-kv[1], kv[0]))[0][0] if depts else None
        full = load >= 9
        campus = Counter(s["campus"] for s in ss).most_common(1)[0][0]
        faculty.append((fid, name, dept, "full_time" if full else "adjunct", max(load, 12 if full else 6), campus, ["employment", "max_credit_load"]))
        quals |= {(fid, s["subject"], s["course_id"]) for s in ss}
    clash_ids = Counter(fid for fid, _ in by_teacher)
    assert max(clash_ids.values()) == 1, "two instructors share an id"
    unknown_subjects = sorted({s["subject"] for s in secs if s["subject"] not in dept_of_subject})
    if unknown_subjects: notes.append(f"**Subjects with no department in the catalog:** {', '.join(unknown_subjects)}.")

    # ---- lecture and lab pairs (from the catalog), and which lecture section each lab belongs to (estimated) ----
    pairs = set()
    for cid, c in courses.items():
        for subj, num in re.findall(r"\b([A-Z]{2,4})\s*(\d{4})\b", (c["coreq"] or "").replace("&nbsp;", " ")):
            if subj + num in courses and subj + num != cid: pairs.add((cid, subj + num))
    by_course = defaultdict(list)
    for s in secs: by_course[s["course_id"]].append(s)
    linked = 0
    for lab in (s for s in secs if s["in_catalog"] and courses[s["course_id"]]["is_lab"] and s["slot"]):
        partners = sorted({b if a == lab["course_id"] else a for a, b in pairs if lab["course_id"] in (a, b)})
        lectures = [s for p in partners if not courses[p]["is_lab"] for s in by_course.get(p, []) if s["slot"]]
        if lectures:
            lab["linked_section_id"] = next((s for s in lectures if s["section_code"] == lab["section_code"]), lectures[0])["section_id"]
            lab["estimated"].append("linked_section_id"); linked += 1
    for s in secs: s.setdefault("linked_section_id", None)

    # ---- student groups: still from the catalog (the file has no student data) ----
    timed = {s["course_id"] for s in secs if s["slot"]}
    by_prog = defaultdict(set)
    for pid, cid, _ in reqs:
        if cid in timed and programs[pid][1] not in ("MINOR", "CERT") and courses[cid]["course_level"] >= 1000:
            by_prog[(pid, courses[cid]["course_level"])].add(cid)
    groups, gcourses = [], []
    for (pid, level), cids in sorted(by_prog.items()):
        if len(cids) < 2: continue
        gid = f"{term}-P{pid}-L{level}"
        groups.append((gid, term, pid, f"{programs[pid][0]}: {level}-level required", "mock_level"))
        gcourses += [(gid, c) for c in sorted(cids)]

    # ---- the timetable as the university ran it ----
    actual = []
    for s in secs:
        a = (s["slot"][0] if s["slot"] else None, s["room_id"], s["teacher"][0] if s["teacher"] else None)
        actual.append((s["section_id"], *a, any(a), "As run by the university" if any(a) else "The file gives no time, room or instructor"))

    staff = sum(1 for s in secs if not s["teacher"])
    notes += [f"**Instructor not named ('Staff TBD'):** {staff} sections have no instructor; the checker reports them as MISSING_FACULTY.",
              f"**Courses not in the scraped catalog:** {len({s['course_id'] for s in secs if not s['in_catalog']})} "
              f"(mostly graduate, 5000 and up); their credits come from the last digit of the course number.",
              f"**Meets at a set time but no room named:** " + ", ".join(f"`{s['section_id']}`" for s in secs if s["delivery_mode"] == "IN_PERSON" and not s["room_id"]) + ".",
              f"**Lecture and lab pairs:** {linked} lab sections linked to a lecture section of their corequisite course (same section letter when there is one)."]
    data = dict(term=term, file=pathlib.Path(path).name, digest=hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest(),
                slots=slots, buildings=sorted(buildings.items()), rooms=rooms, faculty=faculty, quals=sorted(quals), sections=secs,
                pairs=sorted(pairs), groups=groups, gcourses=gcourses, actual=actual, source=source)
    return data, notes


def report(data, notes):
    secs = data["sections"]
    L = [f"# Real data report ({data['term']})", "",
         f"Loaded by `real/load_real.py` from `{data['file']}` (sha256 `{data['digest'][:12]}`). It replaces the mock data in `course_scheduling`.", "",
         "## Counts", "", "| Table | Rows | Real or estimated |", "|---|---|---|",
         f"| `sections` | {len(secs)} | Real; `seat_cap` estimated (enrollment rounded up to 5, at least 5) |",
         f"| `time_slots` | {len(data['slots'])} | Real: every meeting pattern used. `kind` derived: evening from 17:00, lab for 105 minutes or longer |",
         f"| `buildings` | {len(data['buildings'])} | Real codes (names unknown, so the code is the name) |",
         f"| `rooms` | {len(data['rooms'])} | Real; `capacity` (largest section held) and `room_type` (what is taught in it) estimated |",
         f"| `faculty` | {len(data['faculty'])} | Real names; `employment` (9+ credits = full time) and `max_credit_load` estimated |",
         f"| `faculty_qualifications` | {len(data['quals'])} | Real: each instructor is qualified for what they teach this term |",
         "| `faculty_availability` | 0 | Not in the file |",
         f"| `corequisite_pairs` | {len(data['pairs'])} | From the catalog |",
         f"| `student_groups` | {len(data['groups'])} | Still guessed from program requirements (no student data) |",
         f"| `student_group_courses` | {len(data['gcourses'])} | Same |",
         f"| `source_sections` | {len(data['source'])} | The file itself, row for row |",
         f"| `schedule_runs` / `schedule_assignments` | 1 / {len(data['actual'])} | The timetable as run (`solver_version = '{ACTUAL}'`) |", "",
         "## Sections", "", "| | Sections |", "|---|---|"]
    for k, v in Counter(s["delivery_mode"] for s in secs).most_common(): L.append(f"| {k} | {v} |")
    for k, v in sorted(Counter(s["subterm"] for s in secs).items()): L.append(f"| part of term `{k}` | {v} |")
    L += ["", "## Rooms by estimated type", "", "| Type | Rooms |", "|---|---|"]
    for k, v in Counter(r[3] for r in data["rooms"]).most_common(): L.append(f"| {k} | {v} |")
    L += ["", "## Things to know", ""] + [f"- {n}" for n in notes] + [""]
    (HERE / "REPORT.md").write_text("\n".join(L), encoding="utf8")


def write(cur, data, rebuild):
    if cur.execute("select 1 from information_schema.schemata where schema_name = 'course_scheduling'").fetchone():
        if not rebuild: sys.exit("course_scheduling already exists. Use --rebuild to drop it and load the file.")
        runs = cur.execute("select count(*) from course_scheduling.schedule_runs where solver_version <> %s", (ACTUAL,)).fetchone()[0]
        if runs: sys.exit(f"course_scheduling holds {runs} solver run(s); not dropping it.")
        cur.execute("drop schema course_scheduling cascade")
    ddl = (ROOT / "db" / "001_schema.sql").read_text(encoding="utf8")
    cur.execute(re.sub(r"^\s*(begin|commit);\s*$", "", ddl, flags=re.M | re.I))
    cs, t = "course_scheduling.", data["term"]
    cur.executemany(f"insert into {cs}time_slots (slot_id, days, start_time, end_time, kind) values (%s, %s, %s, %s, %s)", data["slots"])
    cur.executemany(f"insert into {cs}buildings (building_id, name, campus) values (%s, %s, %s)", [(b, b, c) for b, c in data["buildings"]])
    cur.executemany(f"insert into {cs}rooms (room_id, building_id, capacity, room_type, estimated) values (%s, %s, %s, %s, %s)", data["rooms"])
    cur.executemany(f"insert into {cs}faculty (faculty_id, name, department_id, employment, max_credit_load, campus, estimated) values (%s, %s, %s, %s, %s, %s, %s)", data["faculty"])
    cur.executemany(f"insert into {cs}faculty_qualifications (faculty_id, subject, course_id) values (%s, %s, %s)", data["quals"])
    cols = ["section_id", "course_id", "section_code", "seat_cap", "credits", "delivery_mode", "campus", "slot_kind", "required_room_type",
            "subterm", "first_date", "last_date", "enrolled", "estimated"]
    cur.executemany(f"insert into {cs}sections (term_id, {', '.join(cols)}, fixed_faculty_id) values (%s, {', '.join(['%s'] * (len(cols) + 1))})",
                    [(t, *[s[c] for c in cols], s["teacher"][0] if s["teacher"] else None) for s in data["sections"]])
    cur.executemany(f"update {cs}sections set linked_section_id = %s where section_id = %s",
                    [(s["linked_section_id"], s["section_id"]) for s in data["sections"] if s["linked_section_id"]])
    cur.executemany(f"insert into {cs}corequisite_pairs (course_id, coreq_course_id) values (%s, %s)", data["pairs"])
    cur.executemany(f"insert into {cs}student_groups (group_id, term_id, program_id, label, source) values (%s, %s, %s, %s, %s)", data["groups"])
    cur.executemany(f"insert into {cs}student_group_courses (group_id, course_id) values (%s, %s)", data["gcourses"])
    cur.executemany(f"insert into {cs}source_sections values ({', '.join(['%s'] * 16)})", data["source"])
    placed = sum(1 for a in data["actual"] if a[4])
    run_id = cur.execute(f"""insert into {cs}schedule_runs (term_id, input_hash, settings, solver_version, status, plan_status, placed_count, unplaced_count,
                                 created_by, approved_by, approved_at)
                             values (%s, %s, %s, %s, 'done', 'approved', %s, %s, 'real/load_real.py', 'the university (as run)', now()) returning run_id""",
                         (t, data["digest"], psycopg.types.json.Jsonb({"source_file": data["file"]}), ACTUAL, placed, len(data["actual"]) - placed)).fetchone()[0]
    cur.executemany(f"insert into {cs}schedule_assignments (run_id, section_id, slot_id, room_id, faculty_id, placed, reason) values (%s, %s, %s, %s, %s, %s, %s)",
                    [(run_id, *a) for a in data["actual"]])
    return run_id


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 1: sys.exit(__doc__)
    path = pathlib.Path(args[0]).expanduser()
    with psycopg.connect(database_url()) as conn:
        with conn.cursor() as cur:
            data, notes = build(cur, path)
            report(data, notes)
            if "--dry-run" in sys.argv:
                print(f"dry run: {len(data['sections'])} {data['term']} sections parsed; nothing written to Neon; see real/REPORT.md"); return
            run_id = write(cur, data, "--rebuild" in sys.argv)
        conn.commit()
    print(f"course_scheduling loaded with {data['term']} from {data['file']}; the timetable as run is solver run {run_id}; see real/REPORT.md")


if __name__ == "__main__":
    main()
