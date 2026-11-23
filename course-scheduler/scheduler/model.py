"""The data the checker and the solver work on: one term's sections and resources, and a timetable (one assignment per section)."""
import csv, os, pathlib, re
from dataclasses import dataclass, field
from datetime import date, time
from typing import Optional

ROOT = pathlib.Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class Slot:
    slot_id: str
    days: str          # M T W R F S U (R = Thursday, U = Sunday)
    start: time
    end: time
    kind: str          # lecture, lab, evening

    def overlaps(self, other: "Slot") -> bool:
        return bool(set(self.days) & set(other.days)) and self.start < other.end and other.start < self.end


@dataclass(frozen=True)
class Window:
    """A stretch of time on some days: when someone can't teach, or prefers to."""
    days: str
    start: time
    end: time

    def overlaps(self, slot: Slot) -> bool:
        return bool(set(self.days) & set(slot.days)) and self.start < slot.end and slot.start < self.end

    def contains(self, slot: Slot) -> bool:
        return set(slot.days) <= set(self.days) and self.start <= slot.start and slot.end <= self.end


@dataclass(frozen=True)
class Room:
    room_id: str
    building_id: str
    capacity: int
    room_type: str
    is_active: bool = True
    estimated: tuple = ()   # columns guessed rather than given, e.g. ("capacity", "room_type")


@dataclass(frozen=True)
class Faculty:
    faculty_id: str
    name: str
    max_credit_load: float
    estimated: tuple = ()


@dataclass(frozen=True)
class Section:
    section_id: str
    course_id: str
    credits: float
    seat_cap: int
    delivery_mode: str
    slot_kind: Optional[str]            # None = no meeting time (asynchronous online, arranged)
    required_room_type: Optional[str]   # None = no room
    linked_section_id: Optional[str] = None
    fixed_faculty_id: Optional[str] = None
    first_date: Optional[date] = None   # None = the whole term
    last_date: Optional[date] = None
    enrolled: Optional[int] = None
    estimated: tuple = ()

    def same_weeks(self, other: "Section") -> bool:
        """False when the two run in different parts of the term (e.g. first and second 8 weeks), so they can never clash."""
        if None in (self.first_date, self.last_date, other.first_date, other.last_date):
            return True
        return self.first_date <= other.last_date and other.first_date <= self.last_date

    @property
    def subject(self) -> str:
        m = re.match(r"[A-Z]+", self.course_id)
        return m.group(0) if m else ""


@dataclass(frozen=True)
class Assignment:
    section_id: str
    slot_id: Optional[str] = None
    room_id: Optional[str] = None
    faculty_id: Optional[str] = None


@dataclass
class Term:
    term_id: str
    slots: dict = field(default_factory=dict)        # slot_id -> Slot
    rooms: dict = field(default_factory=dict)        # room_id -> Room
    faculty: dict = field(default_factory=dict)      # faculty_id -> Faculty
    quals: dict = field(default_factory=dict)        # faculty_id -> {(subject, course_id or None)}
    unavailable: dict = field(default_factory=dict)  # faculty_id -> [Window]
    preferred: dict = field(default_factory=dict)    # faculty_id -> [Window]
    sections: dict = field(default_factory=dict)     # section_id -> Section
    groups: dict = field(default_factory=dict)       # group_id -> (label, [course_id])
    group_source: dict = field(default_factory=dict) # group_id -> 'mock_level' (guessed), 'degree_map' or 'registration'
    together: dict = field(default_factory=dict)     # section_id -> combine_id: sections taught together as one meeting
    mock_availability: set = field(default_factory=set)   # faculty_ids whose availability is made up

    def qualified(self, faculty_id: str, s: Section) -> bool:
        q = self.quals.get(faculty_id, set())
        return (s.subject, s.course_id) in q or (s.subject, None) in q


# ---------- loading ----------

def database_url() -> str:
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("DATABASE_URL="):
                return line.split("=", 1)[1].strip().strip("'\"")
    raise SystemExit("DATABASE_URL is not set (environment or course-scheduler/.env)")


def load_term(cur, term_id: str) -> Term:
    cs = "course_scheduling."
    t = Term(term_id)
    for sid, days, st, en, kind in cur.execute(f"select slot_id, days, start_time, end_time, kind from {cs}time_slots where is_active"):
        t.slots[sid] = Slot(sid, days, st, en, kind)
    for rid, b, cap, rtype, active, est in cur.execute(f"select room_id, building_id, capacity, room_type, is_active, estimated from {cs}rooms"):
        t.rooms[rid] = Room(rid, b, cap, rtype, active, tuple(est))
    for fid, name, mx, est in cur.execute(f"select faculty_id, name, max_credit_load, estimated from {cs}faculty where is_active"):
        t.faculty[fid] = Faculty(fid, name, float(mx), tuple(est))
    for fid, subj, cid in cur.execute(f"select faculty_id, subject, course_id from {cs}faculty_qualifications"):
        t.quals.setdefault(fid, set()).add((subj, cid))
    for fid, days, st, en, kind, src in cur.execute(f"select faculty_id, days, start_time, end_time, kind, source from {cs}faculty_availability"):
        (t.unavailable if kind == "unavailable" else t.preferred).setdefault(fid, []).append(Window(days, st, en))
        if src == "mock": t.mock_availability.add(fid)
    for row in cur.execute(f"""select section_id, course_id, credits, seat_cap, delivery_mode, slot_kind, required_room_type, linked_section_id, fixed_faculty_id,
                                      first_date, last_date, enrolled, estimated
                               from {cs}sections where term_id = %s""", (term_id,)):
        s = Section(row[0], row[1], float(row[2]), row[3], *row[4:12], tuple(row[12] or ()))
        t.sections[s.section_id] = s
    for cid, sid in cur.execute(f"select c.combine_id, c.section_id from {cs}combined_sections c join {cs}sections s using (section_id) where s.term_id = %s", (term_id,)):
        t.together[sid] = cid
    for gid, label, src in cur.execute(f"select group_id, label, source from {cs}student_groups where term_id = %s", (term_id,)):
        t.groups[gid] = (label, [])
        t.group_source[gid] = src
    for gid, cid in cur.execute(f"select g.group_id, g.course_id from {cs}student_group_courses g join {cs}student_groups s using (group_id) where s.term_id = %s order by 1, 2", (term_id,)):
        t.groups[gid][1].append(cid)
    if not t.sections:
        raise SystemExit(f"no sections for term {term_id}")
    return t


def mock_term(cur) -> Term:
    """The step 1 mock term (2027SP), built in memory from the catalog by mock/build_mock.py; nothing is read from or written to course_scheduling."""
    import sys
    sys.path.insert(0, str(ROOT / "mock"))
    import build_mock
    data, _, _ = build_mock.build(cur)
    hm = lambda v: v if isinstance(v, time) else time.fromisoformat(v)
    t = Term(build_mock.TERM)
    for sid, days, st, en, kind in data["time_slots"]: t.slots[sid] = Slot(sid, days, hm(st), hm(en), kind)
    for rid, b, cap, rtype in data["rooms"]: t.rooms[rid] = Room(rid, b, cap, rtype)
    for fid, name, _, _, mx in data["faculty"]: t.faculty[fid] = Faculty(fid, name, float(mx))
    for fid, subj, cid in data["quals"]: t.quals.setdefault(fid, set()).add((subj, cid))
    for fid, days, st, en, kind in data["avail"]:
        (t.unavailable if kind == "unavailable" else t.preferred).setdefault(fid, []).append(Window(days, hm(st), hm(en)))
        t.mock_availability.add(fid)
    for s in data["sections"]:
        t.sections[s["section_id"]] = Section(s["section_id"], s["course_id"], float(s["credits"]), s["seat_cap"], s["delivery_mode"], s["slot_kind"],
                                              s["required_room_type"], s["linked_section_id"], s["fixed_faculty_id"])
    for gid, _, _, label, src in data["groups"]:
        t.groups[gid] = (label, [])
        t.group_source[gid] = src
    for gid, cid in data["gcourses"]: t.groups[gid][1].append(cid)
    return t


def load_run(cur, run_id: int) -> tuple[str, list]:
    row = cur.execute("select term_id from course_scheduling.schedule_runs where run_id = %s", (run_id,)).fetchone()
    if not row:
        raise SystemExit(f"no solver run {run_id}")
    rows = cur.execute("select section_id, slot_id, room_id, faculty_id from course_scheduling.schedule_assignments where run_id = %s and placed", (run_id,)).fetchall()
    return row[0], [Assignment(*r) for r in rows]


def load_csv(path) -> list:
    """CSV with a header: section_id, slot_id, room_id, faculty_id. Empty cells mean none."""
    with open(path, newline="", encoding="utf8") as f:
        return [Assignment(r["section_id"].strip(), *((r.get(k) or "").strip() or None for k in ("slot_id", "room_id", "faculty_id")))
                for r in csv.DictReader(f)]
