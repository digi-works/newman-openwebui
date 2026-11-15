-- Course scheduler: data tables.
-- Lives in its own schema; reads the scraped catalog in course_planning and never changes it.
-- Applied by mock/build_mock.py (step 1), or by hand:  psql "$DATABASE_URL" -f db/001_schema.sql

begin;

create schema if not exists course_scheduling;
set search_path = course_scheduling;

-- ---------- Time ----------

-- One row per meeting time. days uses M T W R F S (R = Thursday).
create table time_slots (
  slot_id     text primary key,                 -- e.g. MWF-0800, TR-0930, LAB-T-1300, EVE-M-1800
  days        text not null check (days ~ '^[MTWRFS]+$'),
  start_time  time not null,
  end_time    time not null check (end_time > start_time),
  kind        text not null check (kind in ('lecture', 'lab', 'evening')),
  is_active   boolean not null default true
);

-- ---------- Space ----------

create table buildings (
  building_id text primary key,                 -- short code, e.g. SCI
  name        text not null unique,
  campus      text not null default 'Wichita'
);

create table rooms (
  room_id     text primary key,                 -- e.g. SCI-201
  building_id text not null references buildings,
  capacity    integer not null check (capacity > 0),
  room_type   text not null check (room_type in ('lecture', 'science_lab', 'computer_lab', 'nursing_sim', 'studio')),
  is_active   boolean not null default true
);

-- ---------- Faculty ----------

create table faculty (
  faculty_id      text primary key,
  name            text not null,
  department_id   integer not null,             -- matches course_planning.departments (one subject per department)
  employment      text not null check (employment in ('full_time', 'adjunct')),
  max_credit_load numeric(4,1) not null check (max_credit_load > 0),
  campus          text not null default 'Wichita',
  is_active       boolean not null default true
);

-- A row qualifies a person for one course, or for a whole subject when course_id is null.
create table faculty_qualifications (
  faculty_id text not null references faculty,
  subject    text not null,                     -- e.g. BIOL
  course_id  text,                              -- e.g. BIOL1013; null = any course in the subject
  unique nulls not distinct (faculty_id, subject, course_id)
);

-- 'unavailable' is a hard rule; 'preferred' is a soft rule.
create table faculty_availability (
  faculty_id text not null references faculty,
  days       text not null check (days ~ '^[MTWRFS]+$'),
  start_time time not null,
  end_time   time not null check (end_time > start_time),
  kind       text not null check (kind in ('unavailable', 'preferred'))
);

-- ---------- What gets scheduled ----------

create table sections (
  section_id         text primary key,          -- e.g. 2027SP-BIOL1013-01
  term_id            text not null,             -- matches course_planning.academic_terms
  course_id          text not null,             -- matches course_planning.courses
  section_code       text not null,
  seat_cap           integer not null check (seat_cap > 0),
  credits            numeric(4,1) not null,
  -- ARRANGED = meets without a classroom (applied music, athletics, field experience, clinical): faculty only, no slot, no room
  delivery_mode      text not null check (delivery_mode in ('IN_PERSON', 'ONLINE_ASYNC', 'ONLINE_LIVE', 'HYBRID', 'ARRANGED')),
  campus             text not null default 'Wichita',
  slot_kind          text check (slot_kind in ('lecture', 'lab')),   -- null = no meeting time (ONLINE_ASYNC, ARRANGED); lecture sections may also use evening slots
  required_room_type text check (required_room_type in ('lecture', 'science_lab', 'computer_lab', 'nursing_sim', 'studio')), -- null = no room
  linked_section_id  text references sections,  -- a lab points at its lecture section
  fixed_faculty_id   text references faculty,   -- set when a chair has already assigned someone
  unique (term_id, course_id, section_code)
);

-- Lecture and lab pairs, parsed from the catalog's corequisite text.
create table corequisite_pairs (
  course_id       text not null,
  coreq_course_id text not null,
  primary key (course_id, coreq_course_id)
);

-- Courses the same students take together: none of a group's courses may overlap.
create table student_groups (
  group_id   text primary key,                  -- e.g. 2027SP-BIOL-BS-L2000
  term_id    text not null,
  program_id integer,                           -- matches course_planning.programs; null for non-program groups
  label      text not null,
  source     text not null check (source in ('mock_level', 'degree_map', 'registration'))
);

create table student_group_courses (
  group_id  text not null references student_groups on delete cascade,
  course_id text not null,
  primary key (group_id, course_id)
);

-- ---------- Results ----------

create table schedule_runs (
  run_id         bigint generated always as identity primary key,
  term_id        text not null,
  input_hash     text not null,                 -- same inputs + settings give the same result
  settings       jsonb not null default '{}'::jsonb,
  solver_version text not null,
  status         text not null check (status in ('running', 'done', 'failed')),
  plan_status    text not null default 'draft' check (plan_status in ('draft', 'in_review', 'approved', 'rejected')),
  placed_count   integer,
  unplaced_count integer,
  created_by     text not null,
  created_at     timestamptz not null default now(),
  approved_by    text,
  approved_at    timestamptz
);

create table schedule_assignments (
  run_id          bigint not null references schedule_runs on delete cascade,
  section_id      text not null references sections,
  slot_id         text references time_slots,
  room_id         text references rooms,
  faculty_id      text references faculty,
  placed          boolean not null,
  reason          text not null,                -- why it went here, or why it could not be placed
  primary key (run_id, section_id)
);

-- What the checker finds. run_id is null when checking a hand-made or edited timetable.
create table rule_violations (
  violation_id bigint generated always as identity primary key,
  run_id       bigint references schedule_runs on delete cascade,
  rule_code    text not null,                   -- e.g. ROOM_DOUBLE_BOOKED, GROUP_OVERLAP, ROOM_TOO_SMALL
  severity     text not null check (severity in ('hard', 'soft')),
  section_ids  text[] not null,
  detail       text not null
);

commit;
