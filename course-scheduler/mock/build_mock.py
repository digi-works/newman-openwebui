"""Step 1: builds the course scheduler's mock data in Neon (schema course_scheduling) from the scraped catalog (course_planning).

Same input, same output: every random choice uses one fixed seed, so a rebuild gives identical data.

    .venv/bin/python mock/build_mock.py --dry-run     # build everything in memory and write mock/REPORT.md; nothing is written to Neon
    .venv/bin/python mock/build_mock.py               # create the schema and fill it (refuses if it already exists)
    .venv/bin/python mock/build_mock.py --rebuild     # drop course_scheduling and build it again (refuses if it holds solver runs)

Reads DATABASE_URL from the environment or from course-scheduler/.env. Never changes course_planning.
"""
import math, os, pathlib, random, re, sys
from collections import Counter, defaultdict

import psycopg

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
TERM, SOURCE_TERM = "2027SP", "2026SP"   # the term we schedule, and the mock term its section list is copied from
SEED = 2027

# ---------- rules that decide how each section meets (mock; see REPORT.md) ----------

ARRANGED = re.compile(r"applied music|intercollegiate|cheer|field experience|internship|practicum|independent study|directed study|capstone clinical|student teaching", re.I)
STUDIO = re.compile(r"painting|drawing|clay|sculpture|printmaking|photography|3d design|design 2|installation", re.I)
ART_COMPUTER = re.compile(r"software|digital imaging|layout|responsive design|user experience|data visualization", re.I)
NURSING_SIM = re.compile(r"assessment|foundations of clinical practice|skills|simulation", re.I)
NOT_COMPUTER = re.compile(r"seminar|career|project labs", re.I)
SCIENCE, HEALTH, COMPUTING = {"BIOL", "CHEM", "PHSC", "ANTH"}, {"NSG", "SONO", "RADT", "RC"}, {"CS", "MIS", "BDA", "DSCI"}

# Weekly hours a section uses a room, and the share of a room's daytime hours we aim to fill, per room type.
HOURS = {"lecture": 2.5, "lab": 170 / 60}
DAY_HOURS = 35.0                          # 14 daytime lecture slots x 2.5 hours
TARGET_USE = {"lecture": 0.65, "science_lab": 0.8, "computer_lab": 0.7, "nursing_sim": 0.7, "studio": 0.7}
BUILDINGS = [  # (id, name). Names are Newman's; which rooms they hold is mock.
    ("DEM", "DeMattias Hall"), ("EDU", "Education Hall"), ("ADM", "Administration"), ("LIB", "Library"),
    ("SCI", "Science Hall"), ("LC", "Learning Commons"), ("FAC", "Fine Arts Center"),
]
HOME = {"lecture": ["DEM", "EDU", "ADM", "LIB"], "science_lab": ["SCI"], "nursing_sim": ["SCI"], "computer_lab": ["LC"], "studio": ["FAC"]}
FT_LOAD, ADJ_LOAD = 12, 6                 # credit hours per term


def time_slots():
    rows = []
    for h in range(8, 16):                                          # Mon/Wed/Fri 50 min, 8:00 to 15:50
        rows.append((f"MWF-{h:02d}00", "MWF", f"{h:02d}:00", f"{h:02d}:50", "lecture"))
    for start in ["08:00", "09:30", "11:00", "12:30", "14:00", "15:30"]:   # Tue/Thu 75 min
        h, m = map(int, start.split(":")); e = h * 60 + m + 75
        rows.append((f"TR-{h:02d}{m:02d}", "TR", start, f"{e // 60:02d}:{e % 60:02d}", "lecture"))
    for days in ["MW", "TR"]:                                       # evenings, 75 min
        rows += [(f"EVE-{days}-1800", days, "18:00", "19:15", "evening"), (f"EVE-{days}-1930", days, "19:30", "20:45", "evening")]
    for d in "MTWRF":                                               # 2h50 lab blocks, morning and afternoon
        rows += [(f"LAB-{d}-0800", d, "08:00", "10:50", "lab"), (f"LAB-{d}-1300", d, "13:00", "15:50", "lab")]
    return rows


def how_it_meets(c, mode, rng):
    """(delivery_mode, slot_kind, required_room_type) for one section."""
    if ARRANGED.search(c["title"]): return "ARRANGED", None, None
    kind = "lab" if c["is_lab"] else "lecture"
    if mode == "ONLINE":
        return ("ONLINE_LIVE", kind, None) if rng.random() < 0.2 else ("ONLINE_ASYNC", None, None)
    s, t = c["subject"], c["title"]
    if c["is_lab"]:
        room = "science_lab" if s in SCIENCE else "nursing_sim" if s in HEALTH else "computer_lab" if s in COMPUTING else "lecture"
    elif s == "ART" and STUDIO.search(t): room = "studio"
    elif (s in COMPUTING and not NOT_COMPUTER.search(t)) or (s == "ART" and ART_COMPUTER.search(t)): room = "computer_lab"
    elif s == "NSG" and NURSING_SIM.search(t): room = "nursing_sim"
    else: room = "lecture"
    return "IN_PERSON", kind, room


def round5(n): return int(math.ceil(n / 5.0) * 5)


def build(cur):
    rng = random.Random(SEED)
    courses = {r[0]: dict(zip(["course_id", "subject", "title", "department_id", "credits", "course_level", "is_lab", "coreq"], r))
               for r in cur.execute("select course_id, subject, title, department_id, credits, course_level, is_lab, corequisite_text from course_planning.courses")}
    src = cur.execute("select course_id, section_code, delivery_mode, seats_offered from course_planning.historical_sections where term_id = %s order by course_id, section_code", (SOURCE_TERM,)).fetchall()
    programs = {r[0]: r[1:] for r in cur.execute("select program_id, name, degree_type from course_planning.programs")}
    reqs = cur.execute("select program_id, course_id, requirement_type from course_planning.program_requirements where requirement_type in ('REQUIRED', 'CAPSTONE')").fetchall()
    capstones = {c for _, c, t in reqs if t == "CAPSTONE"}
    notes = []   # tricky cases, for the report

    # ---- sections ----
    sections = []
    for course_id, code, mode, seats in src:
        c = courses[course_id]
        delivery, kind, room = how_it_meets(c, mode, rng)
        sections.append(dict(section_id=f"{TERM}-{course_id}-{code}", course_id=course_id, section_code=code, seat_cap=int(seats), credits=int(c["credits"]),
                             delivery_mode=delivery, slot_kind=kind, required_room_type=room, linked_section_id=None, fixed_faculty_id=None))
    by_course = defaultdict(list)
    for s in sections: by_course[s["course_id"]].append(s)

    big = next((s for s in sections if s["course_id"] == "BIOL1003" and s["required_room_type"] == "lecture"), None) \
        or next(s for s in sections if s["required_room_type"] == "lecture")
    big["seat_cap"] = 90
    notes.append(f"**Large section:** `{big['section_id']}` ({courses[big['course_id']]['title']}) raised to 90 seats; only the two auditoriums (100 and 120 seats) can hold it.")

    # ---- lecture and lab pairs ----
    pairs = set()
    for cid, c in courses.items():
        for subj, num in re.findall(r"\b([A-Z]{2,4})\s*(\d{4})\b", (c["coreq"] or "").replace("&nbsp;", " ")):
            other = subj + num
            if other in courses and other != cid: pairs.add((cid, other))
    linked = 0
    for lab in (s for s in sections if courses[s["course_id"]]["is_lab"] and s["slot_kind"]):
        partners = [b if a == lab["course_id"] else a for a, b in sorted(pairs) if lab["course_id"] in (a, b)]
        lectures = [s for p in partners if not courses[p]["is_lab"] for s in by_course.get(p, []) if s["slot_kind"]]
        if lectures:
            lab["linked_section_id"] = next((s for s in lectures if s["section_code"] == lab["section_code"]), lectures[0])["section_id"]; linked += 1

    # ---- rooms, sized to demand per room type ----
    need = defaultdict(list)
    for s in sections:
        if s["required_room_type"]: need[s["required_room_type"]].append(s)
    rooms, counter = [], Counter()
    for rtype, secs in sorted(need.items()):
        secs = [s for s in secs if s is not big]
        hours = sum(HOURS[s["slot_kind"]] for s in secs)
        n = max(1, math.ceil(hours / (DAY_HOURS * TARGET_USE[rtype])))
        caps = sorted((s["seat_cap"] for s in secs), reverse=True)
        for i in range(n):
            b = HOME[rtype][i % len(HOME[rtype])]; counter[b] += 1
            cap = round5(caps[min(len(caps) - 1, i * len(caps) // n)]) + (5 if i % 3 == 0 else 0)
            rooms.append((f"{b}-{100 + counter[b]}", b, cap, rtype))
    rooms += [("DEM-AUD", "DEM", 100, "lecture"), ("FAC-AUD", "FAC", 120, "lecture")]
    sci_labs = sum(1 for r in rooms if r[3] == "science_lab")
    notes.append(f"**Few lab rooms:** science labs are sized to {int(TARGET_USE['science_lab'] * 100)}% of daytime lab hours, so {sum(1 for s in need['science_lab'])} science lab sections share {sci_labs} rooms.")

    # ---- faculty and qualifications ----
    dept_secs = defaultdict(list)
    for s in sections: dept_secs[courses[s["course_id"]]["department_id"]].append(s)
    subj_of = {courses[s["course_id"]]["department_id"]: courses[s["course_id"]]["subject"] for s in sections}
    faculty, quals = [], set()   # quals: (faculty_id, subject, course_id)
    staff = defaultdict(list)
    for dept, secs in sorted(dept_secs.items()):
        subj, demand = subj_of[dept], sum(s["credits"] for s in secs)
        ft = max(1, round(demand * 0.7 / FT_LOAD)); adj = max(0, math.ceil((demand * 1.05 - ft * FT_LOAD) / ADJ_LOAD))
        for i in range(ft): staff[dept].append((f"F-{subj}-{i + 1:02d}", f"Prof. {subj} {i + 1:02d}", "full_time", FT_LOAD))
        for i in range(adj): staff[dept].append((f"A-{subj}-{i + 1:02d}", f"Adjunct {subj} {i + 1:02d}", "adjunct", ADJ_LOAD))
        # Every section gets a home teacher with room in their load (full-time first for 3000/4000 level), so a valid assignment exists.
        left = {f[0]: f[3] for f in staff[dept]}
        for s in sorted(secs, key=lambda s: (-s["credits"], -courses[s["course_id"]]["course_level"], s["section_id"])):
            upper = courses[s["course_id"]]["course_level"] > 2000
            fits = [f for f in staff[dept] if left[f[0]] >= s["credits"]]
            pick = sorted(fits, key=lambda f: (upper and f[2] != "full_time", -left[f[0]], f[0]))
            if not pick:
                n = sum(1 for f in staff[dept] if f[2] == "adjunct") + 1
                staff[dept].append((f"A-{subj}-{n:02d}", f"Adjunct {subj} {n:02d}", "adjunct", ADJ_LOAD)); left[staff[dept][-1][0]] = ADJ_LOAD
                pick = [staff[dept][-1]]
            s["_home"] = pick[0][0]; left[pick[0][0]] -= s["credits"]; quals.add((pick[0][0], subj, s["course_id"]))
        # Then one or two more qualified people per course, so the solver has choices.
        for cid in sorted({s["course_id"] for s in secs}):
            c = courses[cid]
            pool = [f for f in staff[dept] if (f[2] == "full_time" or c["course_level"] <= 2000) and (f[0], subj, cid) not in quals]
            for f in rng.sample(pool, min(len(pool), 1 + (rng.random() < 0.5))): quals.add((f[0], subj, cid))
        faculty += [(fid, name, dept, emp, mx) for fid, name, emp, mx in staff[dept]]

    # Tricky: a course only one person can teach (in three departments with at least three faculty).
    singles = []
    for dept in sorted(staff, key=lambda d: -len(staff[d])):
        if len(singles) == 3: break
        if len(staff[dept]) < 3: continue
        cands = [cid for cid in {s["course_id"] for s in dept_secs[dept]} if len(by_course[cid]) == 1 and by_course[cid][0]["required_room_type"]]
        if not cands: continue
        cid = max(cands, key=lambda x: (courses[x]["course_level"], x))
        holders = sorted(q for q in quals if q[2] == cid)
        keep = next(q for q in holders if q[0] == by_course[cid][0]["_home"])
        quals -= set(holders) - {keep}; singles.append((cid, keep[0]))
    notes.append("**Only one qualified teacher:** " + ", ".join(f"`{c}` ({courses[c]['title']}) → `{f}`" for c, f in singles) + ".")

    # Proof that a valid faculty assignment exists: every section's home teacher is qualified and within their load.
    maxload = {f[0]: f[4] for f in faculty}; used = Counter()
    for s in sections:
        assert (s["_home"], courses[s["course_id"]]["subject"], s["course_id"]) in quals, s["section_id"]
        used[s["_home"]] += s["credits"]
    assert all(used[f] <= maxload[f] for f in used), "home assignment over load"

    # Chairs have already assigned capstones.
    fixed = 0
    for s in sections:
        if s["course_id"] in capstones: s["fixed_faculty_id"] = s["_home"]; fixed += 1
    notes.append(f"**Pre-assigned faculty:** {fixed} capstone sections have `fixed_faculty_id` set, as if a chair had already chosen.")

    # ---- availability and preferences ----
    avail = []
    ft_biol = next((f[0] for f in faculty if f[0].startswith("F-BIOL-")), faculty[0][0])
    avail.append((ft_biol, "TR", "08:00", "22:00", "unavailable"))
    notes.append(f"**Unavailable on certain days:** `{ft_biol}` cannot teach on Tuesdays or Thursdays.")
    for fid, _, _, emp, _ in sorted(faculty):
        if fid == ft_biol: continue
        r = rng.random()
        if r < 0.12: avail.append((fid, rng.choice("MTWRF"), "08:00", "22:00", "unavailable"))
        elif emp == "adjunct" and r < 0.40: avail.append((fid, "MTWRF", "08:00", "12:00", "unavailable"))
        if rng.random() < 0.25: avail.append((fid, *rng.choice([("MWF", "08:00", "12:00"), ("TR", "09:30", "15:00")]), "preferred"))

    # ---- student groups: each degree program's required and capstone courses at one level, offered with a meeting time this term ----
    timed = {s["course_id"] for s in sections if s["slot_kind"]}
    groups, gcourses = [], []
    by_prog = defaultdict(set)
    for pid, cid, _ in reqs:
        if cid in timed and programs[pid][1] not in ("MINOR", "CERT") and courses[cid]["course_level"] >= 1000: by_prog[(pid, courses[cid]["course_level"])].add(cid)
    for (pid, level), cids in sorted(by_prog.items()):
        if len(cids) < 2: continue
        gid = f"{TERM}-P{pid}-L{level}"
        groups.append((gid, TERM, pid, f"{programs[pid][0]}: {level}-level required", "mock_level"))
        gcourses += [(gid, c) for c in sorted(cids)]
    sizes = Counter(g for g, _ in gcourses)
    biggest = max(groups, key=lambda g: sizes[g[0]])
    notes.append(f"**Many required courses together:** the largest student group is `{biggest[0]}` ({biggest[3]}) with {sizes[biggest[0]]} courses that must not overlap. "
                 "Groups of more than 14 courses cannot all fit in daytime slots; this is expected to force evening slots or unplaced sections, which the solver must report.")
    notes.append("**Lecture and lab pairs:** " + f"{linked} lab sections are linked to their lecture section and must not overlap it.")
    notes.append("**Mixed delivery:** " + ", ".join(f"{n} {m}" for m, n in Counter(s["delivery_mode"] for s in sections).most_common()) + ".")

    data = dict(time_slots=time_slots(), buildings=[(b, n, "Wichita") for b, n in BUILDINGS], rooms=rooms, faculty=faculty, quals=sorted(quals),
                avail=avail, sections=sections, pairs=sorted(pairs), groups=groups, gcourses=gcourses)
    return data, notes, dict(courses=courses, need=need, singles=singles, sizes=sizes, big=big)


def report(data, notes, x):
    secs, rooms, fac = data["sections"], data["rooms"], data["faculty"]
    L = [f"# Mock data report ({TERM})", "",
         "Generated by `mock/build_mock.py` (seed " + str(SEED) + "). Rebuilding gives the same data. Everything here except the catalog is invented.", "",
         "## Counts", "", "| Table | Rows |", "|---|---|"]
    for name, key in [("time_slots", "time_slots"), ("buildings", "buildings"), ("rooms", "rooms"), ("faculty", "faculty"), ("faculty_qualifications", "quals"),
                      ("faculty_availability", "avail"), ("sections", "sections"), ("corequisite_pairs", "pairs"), ("student_groups", "groups"), ("student_group_courses", "gcourses")]:
        L.append(f"| `{name}` | {len(data[key])} |")
    L += ["", "## Tricky cases (on purpose)", ""] + [f"- {n}" for n in notes]
    L += ["", "## Rooms vs demand (daytime)", "", "| Room type | Sections | Rooms | Use of daytime hours | Seats (min–max) |", "|---|---|---|---|---|"]
    for rtype in sorted({r[3] for r in rooms}):
        rs = [r for r in rooms if r[3] == rtype]; ss = [s for s in secs if s["required_room_type"] == rtype]
        use = sum(HOURS[s["slot_kind"]] for s in ss) / (len(rs) * DAY_HOURS)
        L.append(f"| {rtype} | {len(ss)} | {len(rs)} | {use:.0%} | {min(r[2] for r in rs)}–{max(r[2] for r in rs)} |")
    tight = [(s["section_id"], s["seat_cap"], sum(1 for r in rooms if r[3] == s["required_room_type"] and r[2] >= s["seat_cap"])) for s in secs if s["required_room_type"]]
    tight = [t for t in tight if t[2] <= 2]
    L += ["", f"Sections that fit in at most two rooms: {len(tight)}" + (" (" + ", ".join(f"`{a}` {b} seats → {c} rooms" for a, b, c in tight[:6]) + ")" if tight else "") + "."]
    demand = sum(s["credits"] for s in secs); cap = sum(f[4] for f in fac)
    ft = sum(1 for f in fac if f[3] == "full_time")
    L += ["", "## Faculty vs demand", "", f"- {len(fac)} faculty ({ft} full-time at {FT_LOAD} credits, {len(fac) - ft} adjunct at {ADJ_LOAD}) across {len({f[2] for f in fac})} departments.",
          f"- Teaching demand {demand} credits; capacity {cap} credits ({cap / demand:.0%}).",
          "- A valid faculty assignment exists: every section has a qualified teacher within their load (checked when the data is built).", ""]
    sz = sorted(x["sizes"].values())
    L += ["## Student groups", "", f"- {len(data['groups'])} groups (program × course level), {len(data['gcourses'])} course memberships.",
          f"- Courses per group: min {sz[0]}, median {sz[len(sz) // 2]}, max {sz[-1]}. The daytime grid has 14 lecture slots (8 Mon/Wed/Fri + 6 Tue/Thu) plus 4 evening slots.", "",
          "## How sections meet (mock rules)", "",
          "- **ARRANGED** (faculty only, no slot, no room): titles with applied music, intercollegiate, cheer, field experience, internship, practicum, independent/directed study, capstone clinical, student teaching.",
          "- **Online:** about 1 in 5 online sections is live (gets a time slot, no room); the rest are asynchronous.",
          "- **Room type:** science labs for BIOL/CHEM/PHSC/ANTH labs; nursing simulation for NSG/SONO/RADT/RC labs and NSG assessment/clinical-practice/skills courses; computer labs for CS/MIS/BDA/DSCI (not seminars) and ART software/digital courses; studios for ART painting/drawing/clay/sculpture/print/photo/3D; lecture rooms for the rest.",
          "- **Time slots:** lecture sections use Mon/Wed/Fri 50 min or Tue/Thu 75 min, or an evening slot (soft rule: avoid); lab sections use 2h50 lab blocks.", ""]
    (HERE / "REPORT.md").write_text("\n".join(L), encoding="utf8")


def write(cur, data, rebuild):
    exists = cur.execute("select 1 from information_schema.schemata where schema_name = 'course_scheduling'").fetchone()
    if exists:
        if not rebuild: sys.exit("course_scheduling already exists. Use --rebuild to drop it and build it again.")
        runs = cur.execute("select count(*) from course_scheduling.schedule_runs").fetchone()[0]
        if runs: sys.exit(f"course_scheduling holds {runs} solver run(s); not dropping it.")
        cur.execute("drop schema course_scheduling cascade")
    ddl = (ROOT / "db" / "001_schema.sql").read_text(encoding="utf8")
    cur.execute(re.sub(r"^\s*(begin|commit);\s*$", "", ddl, flags=re.M | re.I))
    cs = "course_scheduling."
    cur.executemany(f"insert into {cs}time_slots (slot_id, days, start_time, end_time, kind) values (%s, %s, %s, %s, %s)", data["time_slots"])
    cur.executemany(f"insert into {cs}buildings (building_id, name, campus) values (%s, %s, %s)", data["buildings"])
    cur.executemany(f"insert into {cs}rooms (room_id, building_id, capacity, room_type) values (%s, %s, %s, %s)", data["rooms"])
    cur.executemany(f"insert into {cs}faculty (faculty_id, name, department_id, employment, max_credit_load) values (%s, %s, %s, %s, %s)", data["faculty"])
    cur.executemany(f"insert into {cs}faculty_qualifications (faculty_id, subject, course_id) values (%s, %s, %s)", data["quals"])
    cur.executemany(f"insert into {cs}faculty_availability (faculty_id, days, start_time, end_time, kind) values (%s, %s, %s, %s, %s)", data["avail"])
    cols = ["section_id", "course_id", "section_code", "seat_cap", "credits", "delivery_mode", "slot_kind", "required_room_type", "fixed_faculty_id"]
    cur.executemany(f"insert into {cs}sections (term_id, {', '.join(cols)}) values (%s, {', '.join(['%s'] * len(cols))})",
                    [(TERM, *[s[c] for c in cols]) for s in data["sections"]])
    cur.executemany(f"update {cs}sections set linked_section_id = %s where section_id = %s",
                    [(s["linked_section_id"], s["section_id"]) for s in data["sections"] if s["linked_section_id"]])
    cur.executemany(f"insert into {cs}corequisite_pairs (course_id, coreq_course_id) values (%s, %s)", data["pairs"])
    cur.executemany(f"insert into {cs}student_groups (group_id, term_id, program_id, label, source) values (%s, %s, %s, %s, %s)", data["groups"])
    cur.executemany(f"insert into {cs}student_group_courses (group_id, course_id) values (%s, %s)", data["gcourses"])


def database_url():
    if os.environ.get("DATABASE_URL"): return os.environ["DATABASE_URL"]
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("DATABASE_URL="): return line.split("=", 1)[1].strip().strip("'\"")
    sys.exit("DATABASE_URL is not set (environment or course-scheduler/.env)")


def main():
    dry, rebuild = "--dry-run" in sys.argv, "--rebuild" in sys.argv
    with psycopg.connect(database_url()) as conn:
        with conn.cursor() as cur:
            data, notes, extra = build(cur)
            report(data, notes, extra)
            if dry:
                print("dry run: nothing written to Neon; see mock/REPORT.md"); return
            write(cur, data, rebuild)
        conn.commit()
    print("course_scheduling built; see mock/REPORT.md")


if __name__ == "__main__":
    main()
