# Digi Academics: architecture (proposal v0.2)

Status: proposal for review, no code yet. Inputs: the Newman rotation deck (source of truth for sequencing), the blueprint,
research on UniTime and Ad Astra (`research-notes.md`). The PRD/TDD (original and revised) are reference only.

**Decisions that stay regardless of the PRD/TDD:** PostgreSQL (not MySQL), separate Python service for domain and solver, staff-only
Academic Planner worker, per-customer deployment with a reusable core, R1 = UI + CSV export (no SIS write-back), Fall 2026 sheets as
synthetic data. Where the docs disagree, these win.

## 1. Principles

1. **Rules and solver decide. AI explains. People approve.** Nothing the model says is a fact unless a tool returned it.
2. **One rule set, three uses.** The same rule definition validates a plan, constrains the solver and produces the explanation.
3. **Everything is a version.** Plans, scenarios and solver runs are immutable once saved. Same inputs give the same result.
4. **Reusable by design.** The domain model is institution-neutral. Newman is configuration and data, not code.
5. **Deterministic first.** Build milestones M0-M5 so a planner can finish the whole workflow with no AI at all.

## 2. Shape of the system

```
  Browser (Ask Digi portal, Next.js)          Open WebUI (Ask Digi / Academic Planner worker)
        |  Academics pages (staff only)              |  tools (typed, read + propose only)
        v                                            v
  Portal server routes  ------------------->  Academics API (FastAPI, private network)
   (session + role check, no direct DB)               |
                                                      +--> Domain services (catalog, rotation, sections, scenarios, approvals)
                                                      +--> Rules engine (rule definitions -> validators + constraints)
                                                      +--> Solver service (interface; CP-SAT first)
                                                      +--> Import / export + reconciliation
                                                      v
                                                 PostgreSQL (operational + immutable snapshots + audit)
```

- **Separate service** (`digi-academic`) in its own repo/monorepo. It never trusts the browser: the portal calls it server-side
  after checking the user's session, and Open WebUI tools call it with a shared key on the private Docker network (the same
  pattern as the room request tool).
- **Why Python:** OR-Tools CP-SAT has first-class Python support and the Newman deck and blueprint both assume it. The portal stays
  TypeScript. Contract between them is OpenAPI, generated types on the portal side.
- **Why Postgres:** your stack already runs it; JSONB suits rule definitions and snapshots; one fewer database engine per customer.
  (The deck's MySQL stored procedures are replaced by versioned SQL views plus service code. No business logic only in procedures.)
- **Per customer today, reusable always:** one deployment per customer, one `institution` row of configuration (terms, slot
  naming, roles, thresholds). No tenant column until a hosted multi-tenant version is needed, but nothing hard-codes "Newman".

## 3. Domain model (canonical, SIS-neutral)

- **Institution:** Institution, Campus, College, Department.
- **Curriculum:** Program, ProgramVersion, Requirement, Course, Prerequisite, Corequisite, Equivalency.
- **Planning:** AcademicYear, Term, RotationSlot, RotationRule, AcademicPlan, PlanVersion, Placement, SectionRequirement, DemandProjection.
- **Scheduling (R2):** CourseOffering, Section, SectionComponent, MeetingPattern, Timeslot, Assignment, Constraint, Preference.
- **Faculty/Space (R2):** Faculty, Qualification, Availability, Load, EmploymentType; Building, Room, Feature, RoomType.
- **Students (R3):** Student, CourseRequest, DegreeRequirement, ProjectedDemand, StudentConflict.
- **Governance:** Scenario, Override, Approval, AuditEvent, RuleEvaluation, SolverRun, Publication, ImportBatch, ExternalIdMap.

Rotation slots are data, not an enum: Newman's four (Fall Even, Spring Odd, Fall Odd, Spring Even) are one `RotationPattern`
configuration, so a school with a three-year cycle or a trimester calendar is a new configuration, not a code change.

## 4. Rules engine

- A rule is a record: `id`, class (hard academic, soft academic, hard operational, economic), scope, parameters, weight, effective
  term, status. Examples: `capstone_in_slot`, `min_frequency`, `prerequisite_order`, `max_consecutive_gap`.
- A rule type has three implementations behind one interface: **validate** (plan -> pass/fail + evidence), **constrain** (add to the
  solver model with a named constraint ID), **explain** (evidence -> structured reason). The LLM only phrases the structured reason.
- Hard rules cannot be violated except through an Override that policy allows, with a reason, an actor and an audit event.
- Rule changes are versioned by effective term, so an old plan still validates against the rules it was built under.

## 5. Solver

- `Solver` interface with `check`, `optimise`, `repair` (UniTime's three modes). CP-SAT is the first implementation, Timefold or
  a UniTime-style search can be added behind the same interface after the planned spike.
- R1 models **section counts per course per term** (the deck's allocation problem): hard rules first, then maximise a value score.
  Time, room and instructor placement arrives in R2 as separate layers, not one giant model.
- Every run stores inputs hash, rule versions, solver version, parameters, seed, output and a named-constraint report.
  `compare(runA, runB)` powers the scenario page and "what if 15% instead".

## 6. Governance and audit

Plan state machine: `draft -> validated -> in_review -> approved -> published`. Publishing in R1 is a CSV export plus a record of who
published it; it never writes to a source system. Approvers and who decides overrides are configurable roles (still to be decided).
Roles map from Open WebUI groups to Digi roles: Strategist, Tactician, Approver, Department chair, Administrator.

## 7. Ask Digi (Academic Planner worker, staff only)

Typed tools only, no SQL, no free-form writes: `get_plan`, `list_exceptions`, `run_scenario`, `compare_scenarios`, `explain_placement`,
`propose_override` (creates a request, never approves). Every number in an answer is labelled by origin: institutional fact, rule
result, solver recommendation, planner override or AI explanation. A grounding test suite asserts no tool data means no number.

## 8. Integration

Inbound: import templates (catalog, programs, requirements, past sections, rooms, faculty) with a reconciliation report on every
batch (counts read, kept, dropped, warnings). External IDs live in `ExternalIdMap`. Outbound R1: CSV. Later: batch file, REST,
scheduled push, always from an approved publication.

## 9. Quality gates

Rule unit tests, golden-plan tests (a synthetic Newman-like dataset with an approved expected four-year plan), solver feasibility
(hard constraints never traded for score), scenario determinism, AI grounding, import reconciliation, planner UAT. UniTime's ITC 2019
instances are used as solver benchmarks from R2.

## 10. R1 milestones (build order)

| M | Scope | Done when |
|---|---|---|
| M0 | Repo, Docker, CI, FastAPI skeleton, Postgres, migrations, health checks, portal proxy + role check | Everything builds, health green |
| M1 | Catalog, programs, requirements, terms, import templates, reconciliation | Sample import with an error report |
| M2 | Rules model, validators, explanations | Rule tests and traceability pass |
| M3 | Four-year plan generator, versions, validation, exceptions | Golden plan reproduced, 0 hard violations |
| M4 | Planner UI (Overview, Plan, Rules, Courses, Exceptions, Approvals) | Planner finishes the workflow without chat |
| M5 | Section scenarios on CP-SAT, compare, immutable runs | Deterministic baseline vs target |
| M6 | Ask Digi tools, provenance, grounding tests | No invented numbers |

R2 to R5 follow the order in the mockup menu: Scheduling, Students, Insights, Campus.

## 11. Decisions I need confirmed

1. Separate Python service plus Postgres, portal as the UI (this document).
2. Staff-only "Academic Planner" worker, separate from the student-facing Digi.
3. R1 publishes CSV only.
4. Roles and approvers: configurable, defaults as in the mockup, to be set with Newman.

## 12. Changes in v0.2 (adopted from the revised PRD/TDD, kept consistent with the decisions above)

- **Plan states:** `draft -> submitted -> approved -> exported`. Approval is bound to a content hash; any later edit invalidates it.
- **Waivers vs acknowledgements:** hard-rule waivers name rule, exact scope, expiry and a separate approver (proposer cannot approve).
  Soft rules are acknowledged. Some failures are **blocking and non-waivable** (e.g. a capstone with zero sections).
- **Check results:** pass, fail, not applicable, **insufficient data**. Missing data is never a pass.
- **Scenarios in R1:** tactician sets section counts, the reduction % is an advisory target. The solver does not choose counts in R1
  (M5 becomes validation and risk flags; CP-SAT optimisation moves to R2). Demand and cost show "Unavailable" until supplied.
- **Roles:** Strategist, Tactician, Chair/Dean, Registrar, Faculty contributor, Administrator, Read only, with department scope.
  Approval routes are versioned configuration. Revocation applies on the next call.
- **Exports:** labelled DRAFT or APPROVED, carry version, content hash, rule-set version and data-as-of. Export is a handoff, never a publish.
- **Ask Digi tools renamed to the typed set:** `get_plan_summary`, `explain_offering`, `list_exceptions`, `compare_versions`,
  `create_scenario`, `generate_rotation`, `propose_count_changes`. Every answer follows a response contract (scope, baseline, proposal,
  status, data-as-of, next action) and provenance labels. No approve, waive, publish or SQL tools.
- **Solver statuses (R2):** OPTIMAL, FEASIBLE, INFEASIBLE, UNKNOWN. A time-out is never reported as impossible. Every result is
  independently validated.
- **Settings group added:** Calendar & Terms (parity from calendar year), Roles & Approvals, Imports & Reconciliation, Integrations,
  Audit Log, Replacement Readiness. Objectives & Cost added under R2.
- **Not adopted:** MySQL, any plan to run optimisation in R1, SIS publish in R1, forecasting models beyond a seasonal baseline.

## 13. Open items for you

1. Hosting: pilot runs on a laptop + tunnel. The PRD's recovery and availability targets need real hosting before a live term.
2. Tenant column: stay per customer with no tenant id (current), or add `tenant_id` now for a later hosted version.
3. Approver routes and who may waive: defaults only until Newman decides.
4. Student/SIS identity key and summer or part-of-term calendars: not configured, plans needing them are blocked.
5. Golden four-year schedule is not available, so M3 acceptance uses a synthetic expected plan until Newman supplies one.
