# Digi platform architecture (proposal v0.3)

Status: design only, nothing built from this yet. Supersedes the identity and chat parts of the earlier portal (OWUI logins, browser-stored
history) and sits under `docs/academics/architecture.md` (the Academics module will run on this foundation).
Inputs: the "Option 1" production design (Digi is the system of record, Open WebUI is an internal runtime), my review of it, and the
decision that room booking is split into requester and approver.

## 1. Decision

Digi owns users, tenants, authentication, roles, permissions, conversations, memory, context, capabilities, business data and audit.
Open WebUI (OWUI) is a private runtime: model connections, the tool-call loop and MCP. It owns no Digi data and can be replaced.

## 2. Adopted as written
One shared OWUI runtime account; Digi-owned conversations and memory; tools are business functions (never SQL); permissions checked
before a tool is exposed and again at execution; business audit separate from AI-run audit; read / write / high-impact tool classes;
OWUI in its own database inside the same Postgres cluster; OWUI never customer-facing; one agent (Digi) whose capabilities depend on the
user; tenant_id on every tenant-owned table with row-level security as a backstop.

## 3. Amendments to the Option 1 design

| # | Amendment | Why |
|---|---|---|
| A1 | The execution-context handle is the OWUI **chat id** we already control (random, unguessable, short-lived, bound to one user and conversation). **S0 spike passed on 7 Oct 2026** (see `spikes/s0/RESULT.md`): a tool recovered the right user for two concurrent turns on one runtime account. The id must start with `local:` so OWUI does not save the chat. | Option 1 assumes OWUI forwards a message id to tools. Not verified for 0.11.3. |
| A2 | Permissions are **checked live** at execution. The stored snapshot is for audit only. | A snapshot lets a revoked user keep acting until expiry. |
| A3 | Write tools never commit on the model's say-so. They return a **pending action** that the Digi UI shows. The user's click on Confirm executes it on the server. Every write carries an idempotency key. | "The user said yes" in model text is not a control. A retry must not double-book. |
| A4 | Phase 1 passwords use a vetted auth library (MFA-ready, reset, lockout, breached-password check). User creation is by invite or bulk import. Identity table (`user_identities`) exists from day one so SSO with the university provider is the first step after Phase 1. | Do not hand-roll credentials for student data. |
| A5 | OWUI chats are non-persistent. OWUI's native memory is off. Only runtime accounts exist in OWUI. | Otherwise every student's messages accumulate under one account. |
| A6 | `OWUIClient` is a thin interface with contract tests and a pinned OWUI version. A direct LLM client stays a possible fallback. | The headless tool loop depends on OWUI websocket events, which can change between versions. |
| A7 | Memory starts as an explicit "remember this" with a user view and delete. No automatic extraction. | Automatic extraction can be poisoned by prompt injection. |
| A8 | Tool and MCP results are untrusted text. Raw payloads are not stored in conversations or logs, only summaries. | Indirect prompt injection and PII. |
| A9 | Role-to-permission mapping is data. Permission codes are seeded in code. The admin role editor comes later. | Keeps Phase 1 small. |
| A10 | Tenant is resolved from the hostname. Row-level security scope is set per transaction, with a test that proves it works through the connection pooler. | Pooler sessions are shared. |
| A11 | **Scale design for the OWUI runtime.** Use a pool of runtime accounts and one persistent websocket per portal instance and account that carries many chats and routes events by chat id. Do not open a socket per turn on a single account. | Measured 8 Oct 2026: every socket on an account receives every chat's events, so traffic grows with the square of concurrent chats (see `spikes/s0/LOAD.md`). |
| A12 | **Admission control in Digi.** Global, per-tenant and per-user caps on concurrent turns, a short queue with a visible "Digi is busy" state, connect retries with jitter, hard timeouts and cancel. | At 100 concurrent turns 12% failed and turns took 10 times longer. |
| A13 | **Production OWUI is horizontally scalable:** Postgres instead of SQLite, Redis for sockets, more than one worker or replica, all private. A capacity target and load test gate release (M6). | The pilot OWUI is one worker on SQLite with no Redis. |
| A14 | **Customer-provided LLM keys (BYOK).** Each customer supplies the key for their own model account. Digi stores a reference to it in a secret store (never the key in an ordinary table, never sent to the browser, the model or logs), maps each tenant to its connection and model profiles, and reads the provider's rate-limit headers to learn the customer's real limits. The admission control in A12 uses those limits. A 429 is shown to users as "your university's AI quota is busy" and alerts the customer's Admin. | The customer owns cost, quota and the provider data agreement, so limits and spend are isolated per customer. Digi cannot promise throughput the customer's tier does not allow. |

## 4. Where this differs from earlier decisions
- **Shared Postgres across customers** replaces "one database per customer". Decision for now: the schema is tenant-aware with RLS from the
  start, but Newman is still deployed as its own stack. A shared cluster is a later deployment option, not a Phase 1 assumption.
- **Supabase** is consolidated into the Digi Postgres (rooms, buildings, events, bookings move over). The Supabase project is a pilot store.
- **Workers page and finance workers** become capabilities behind Digi (pending a decision, section 8).

## 5. Room booking: requester and approver

Two roles work one request.

| | Requester (Student, Faculty, Staff) | Approver (Admin in Phase 1; Facilities Approver later) |
|---|---|---|
| Permissions | `rooms.search`, `rooms.request`, `rooms.read_own`, `rooms.cancel_own` | `rooms.read_all`, `rooms.approve` (all buildings for Admin; scoped by building for a later Facilities Approver role), plus the requester permissions |
| Sees | Own requests and their status, room availability | The approval queue for their buildings, full request detail |
| Can do | Request a room, edit or cancel a pending request | Approve or decline with a reason, in the UI |

**States:** `pending -> approved | declined | cancelled | expired`. Approved can be cancelled by the requester or the approver (with a reason).

**Rules:**
1. Separation of duties: an approver cannot decide their own request.
2. A pending request holds the slot (as now). It expires after 7 days (tenant setting) if nobody decides.
3. At approval, availability is rechecked in the same transaction. If something else took the slot, the approval is refused and the
   conflict is shown.
4. Decisions need a reason for declines. Every state change writes an `audit_events` row and a `booking_events` history row.
5. Optimistic locking (a version number) stops two approvers deciding the same request.
6. Approving, declining and bulk actions are **UI-only** in Phase 1. Digi can show an approver the queue and summarise it, but the
   decision is a click, never a tool call.
7. The requester is told when a decision is made, in the app only (notification bell and My requests).

**Digi tools for this:** `search_rooms`, `check_availability`, `request_booking` (returns a pending action to confirm), `my_bookings`,
`cancel_booking` (pending action), and for approvers `approval_queue` (read only).

**Tables** (all with `tenant_id`): `bookings` (requester_user_id, room_id, start, end, purpose, attendees, needs, status, version,
decided_by_user_id, decided_at, decision_reason), `booking_events`, `approver_scopes` (user, building).

## 6. Build plan (sequence, nothing started)

| Step | Scope | Done when |
|---|---|---|
| **S0 Spike (PASSED 7 Oct)** | One headless OWUI turn from the portal that calls a Digi tool, where the tool gateway recovers the real user from the chat id. Confirm non-persistent chats and memory off. | Identity recovered with no OWUI user per person. If it fails, redesign before M1. |
| **M1 Foundation (DONE 7 Oct)** | Postgres container (databases `digi` and `owui`), migrations, tenants, users (created by an Admin), sessions, login with the auth library, hostname tenant resolution, seeded Newman tenant and test users, RLS skeleton. Replaces OWUI login. | A user signs in with no OWUI account. A tenant-isolation test suite passes. |
| **M2 RBAC (DONE 7 Oct)** | Seeded permissions, roles, route and server-action checks, UI gating (navigation and buttons), approver scopes, minimal user and role assignment page. | Changing a role changes what the UI and the API allow. |
| **M3 Conversations (DONE 8 Oct)** | Conversations and messages tables, server-side history and resume across devices, streaming with persistence, stop, titles, context builder v1 (system prompt sections, recent messages), `OWUIClient`. Browser history store removed. | Same conversation continues on another device. User B cannot open user A's chats by ID. |
| **M4 Booking split** | Move rooms, buildings, events and bookings into Digi Postgres. Booking service with the rules in section 5. Pages: Request a room, My requests, Approvals queue (approvers). Notification bell. | Requester asks, approver decides, requester sees the result, with conflicts handled. |
| **M5 AI gateway** | Execution context, tool gateway, tool contract with permission and risk level, capability registry, booking tools, confirm-in-UI flow, per-turn tool selection by permission, `ai_runs` and `audit_events`. | End-to-end Phase 1 scenario passes. A student's session cannot reach approver tools. |
| **M6 Hardening** | Memory (explicit), retention job (30 days) and settings, rate limits and cost caps per user and tenant, CSRF and cookie review, secrets, backups with a restore test, a load test to the agreed concurrent-chat target on the production-shaped OWUI (A13), prompt-attack, ID-tampering and tool-tampering test packs. | Test packs pass. A restore has been rehearsed. |
| Then | Academics module on the same tenant, user, role and tool-gateway foundation. SSO. | |

Each step is a release that can be demonstrated on its own. M1 to M3 change no visible behaviour except login and history. M4 is the first
user-visible change.

### M1 as built (7 Oct 2026)
- Postgres 16 container with databases `digi` and `owui`; roles `digi_owner` (migrations), `digi_app` (runtime, cannot bypass RLS), `owui_app`. Migrations run at start (`db/migrate.mjs`).
- Tenants resolved from the hostname; Newman seeded (`db/seed-newman.mjs`). Users, sessions (only the token hash is stored), identities, audit and execution contexts all have row-level security, forced on the owner too.
- **Deviation from A4:** authentication uses Node's built-in scrypt and standard random session tokens, not an auth framework. The frameworks we looked at bring their own user tables, which conflicts with tenant-scoped, RLS-protected users. Lockout (5 failures, 15 minutes), forced first-sign-in password change and a password policy are built. SSO is still the first step after Phase 1, and an OIDC library fits there. Breached-password checking is not built.
- Admin creates users (Users page); there is no sign-up route. Admin cannot disable or demote themself. Passwords are shown once.
- Chat runs through one OWUI runtime account. Each turn gets an execution handle (the OWUI chat id). The room tool sends it back and Digi recovers the real user. A forged handle, or none, is refused.
- Verified: smoke test 24/24 (`scripts/m1-smoke.py`), isolation tests 18/18 (`db/tests/`), and a real chat turn that saved a booking as the signed-in student.
- Still open from M1: OWUI itself still runs on its own SQLite file (moving it to the `owui` database belongs with A13), and roles are a column until M2.

### M2 as built (7 Oct 2026)
- **Model:** `permissions` (catalog by module, seeded by migrations), `roles` per tenant, `role_permissions`, `user_roles`. A person gets the union of their roles' permissions, read from the database on every request, so a change applies on the next click. The Admin role "grants all" (including permissions added later) and cannot be edited.
- **Permissions today** (12): chat.use; bookings.view_own, view_all, create, update, delete, approve; users.view, create, update, disable; roles.manage. `bookings.update` and `bookings.delete` are saved with roles but no screen uses them yet (shown as "coming"); they take effect when booking editing and cancelling are built in M4.
- **Defaults:** Student and Faculty: chat, view own, request a room. Staff: those plus view all bookings and approve. Admin: everything. Changeable on Settings → Permissions.
- **Settings → Permissions:** pick a role, tick actions by module, save; create and delete custom roles (not while people hold them). Roles are given to people on Settings → Users.
- **Booking visibility:** without "view all bookings" a person sees only their own requests, on the page and in Digi's `list_bookings`. Approving needs `bookings.approve`, and nobody can decide their own request.
- **Guardrails:** only an Admin can give, remove or change the Admin role or touch an Admin account; no self role change or self disable; at least one active Admin must remain.
- **Found and fixed by the isolation tests:** a row could reference another tenant's role. Migration 0004 makes foreign keys tenant-scoped.
- **Verified:** RBAC test 46/46 (`scripts/m2-rbac-test.py`), sign-in smoke test 24/24, isolation tests 23/23.
- **Not yet:** the Digi tool gateway checks only create and view-bookings permissions; the full per-turn tool selection by permission is M5. Bookings are matched to their owner by email until M4 moves them into Digi Postgres.

### M3 as built (8 Oct 2026)
- **Server-owned conversations:** `conversations`, `messages`, `user_favorites` in Digi Postgres (migration 0005), with row-level security and tenant-scoped foreign keys. Every query is scoped by the signed-in person; someone else's conversation answers 404. The browser stores nothing: the localStorage store is gone, and the chat page, History, the sidebar and favorites read from the server.
- **The browser no longer sends history.** `/api/chat` takes only the conversation id and the new message. Digi loads the history, saves both messages, builds the request, and streams events back (meta, queued, tool, embed, text, done, error). The answer is saved as it arrives, every 1.5 seconds, so Stop or a dropped tab keeps what was said (status stopped). A second message while Digi is still answering in the same conversation is refused (409).
- **Context builder v1** (`src/lib/context-builder.ts`): one place that assembles every request: a short note (today's date, the person's first name and role, the university) after the worker's own instructions, then the last 24 messages within 16,000 characters. No rolling summary yet.
- **RuntimeAdapter** (`src/lib/runtime/`): runtime-neutral contract with `capabilities()`, `validate()`, `startExecution()` and `health()`. `OwuiRuntimeAdapter` is implementation 1; it reports honestly (no native persistent memory, no agent handoff). Compile and continue arrive with Studio and M5.
- **Pooled, multiplexed sockets (A11):** several runtime accounts (`OWUI_RUNTIME_POOL`, provisioned by `scripts/provision-runtime-pool.py`), one persistent websocket per account carrying many chats, events routed by chat id, reconnect with backoff and jitter, connect retries. Stop or a closed tab aborts the OWUI task.
- **Admission control (A12):** per instance, 12 turns at once by default, 2 per person, a queue of 200 with a 30 second wait; fair when a slot frees. People see "Digi is busy. N ahead of you" and a plain message if the wait runs out. Tunable with `ADMISSION_*`.
- **Verified:** conversation tests 41/41 (`scripts/m3-test.py`), isolation tests 27/27, sign-in 24/24, permissions 46/46, and the browser (chat, reload, History).
- **Load:** 0 failures at 80 simultaneous people, but about 33 seconds per turn at 40: OWUI on one worker is now the ceiling (see `spikes/s0/LOAD.md`). Addressed by A13 and by the customer's provider tier.
- **Not yet:** retention (M6.2), rolling summaries, per-turn tool selection by permission (M5.5), and the OWUI database move (A13).

### M4 as built (7 Oct 2026)
- **Bookings live in Digi Postgres** (migration 0006: `buildings`, `rooms`, `events`, `event_occurrences`, `bookings`, `booking_events`, `notifications`), copied from the old store, with row-level security and tenant-scoped foreign keys. A btree_gist exclusion constraint makes double-booking impossible even under concurrent requests (the second one gets 409).
- **Requester and approver are separate.** Anyone with `bookings.create` requests a room from the Request a room page (`/bookings/new`: date, time, people, building, needs, then free rooms, then request) or through chat. Anyone with `bookings.approve` (Admin and Staff by default) decides it, with a reason. Nobody decides their own request. Decisions use the row `version`, so a stale screen gets 409 instead of overwriting. A pending request holds its slot for 7 days (tenant setting), then expires.
- **Visibility:** without `bookings.view_all` a person sees only their own bookings (page and API). Requesters can edit their own pending request and cancel it; an approver can cancel any booking with a reason. Events block rooms.
- **In-app notifications:** the bell shows requests waiting for approvers and decisions or cancellations on a person's own requests. No email.
- **Chat tool path:** the OWUI room tool sends the per-turn chat handle on every call (search, list, buildings, request); Digi recovers the real person and tenant from it. Without it the internal routes refuse.
- **Verified:** booking tests 31/31 (`scripts/m4-test.py`), permissions 46/46, conversations 41/41, sign-in 24/24, isolation 35/35 (now including the booking tables).
- **Gone:** the Supabase booking connection (`SUPABASE_DB_URL`) is no longer used by the portal.

### M5 as built (7 Oct 2026)
- **One front door for tools (Tool Gateway, M5.1):** every Open WebUI tool calls `POST /api/internal/tools/<name>` with the per-turn chat handle. Digi recovers the person from the handle (never from arguments), asks Authority, runs a business function (never SQL) and records the call. The old per-route internal endpoints are gone, including the one that committed a booking without a confirm click.
- **Registry (M5.2):** `src/lib/tools/registry.ts` declares each tool (permission, risk read/write/high_impact, tool module). Tables `capabilities` (global catalogue) and `tenant_capabilities` (switch off, or set ask/deny, per organisation). A tool without a permission cannot be registered (code and a database check). The finance workers are disabled capabilities, not deleted.
- **Authority (M5.7):** `src/lib/authority.ts` is pure: allow only if the actor's live permissions, the Worker policy (subworkers cannot widen their parent) and the tool policy all say so. Results ALLOW, ASK, DENY. Actors are a person or a named service identity. An approval turns ASK into ALLOW but never overrides DENY. 14 unit tests.
- **Booking tools (M5.3):** list rooms, form, search, list bookings, request, cancel, approval queue (read only). Approve and decline are not tools.
- **Confirm in the UI (M5.4):** a write tool only prepares a pending action. A card in the chat shows it; the person's Confirm click (an authenticated Digi request) commits it, at most once (atomic claim plus idempotency key), after re-checking permissions. "Yes, confirmed" typed in chat changes nothing. Cards survive a reload; unconfirmed ones expire after 30 minutes.
- **Per-turn tool selection and run records (M5.5):** the Digi agent is offered only the tool modules the person may use (`digi_rooms`, `digi_bookings`, `digi_approvals`, `digi_mcp`). Every response writes an `ai_runs` row (model, tools offered, queue time, duration, tokens when the runtime reports them, status) and each tool call a `tool_calls` row, with no raw payloads.
- **Customer AI key (M5.6):** Settings > AI connection (permission `ai.manage`). The key is encrypted at rest (AES-256-GCM, `DIGI_SECRET_KEY`), never returned or logged, tested against the provider, rate limits read, compared with the number of users, and applied to the matching Open WebUI connection ("Use this key"). A rejected or throttled key raises an admin alert; people only see "AI quota is busy". The server holds the Open WebUI admin token (`OWUI_API_KEY`) for the apply step only. In production the secret key belongs in a KMS (M6).
- **Durable job engine (M5.8):** Postgres queue (`jobs`, `approvals`), leases with heartbeat, `FOR UPDATE SKIP LOCKED`, per-tenant concurrency cap, retries with back-off and a ceiling, idempotency keys, cancellation, checkpoints. A job whose worker dies is picked up again and continues from its checkpoint (tested by killing the server mid-job). When Authority says ASK the call becomes a `tool.call` job that waits for approval; a person with `approvals.decide` (Admin by default) decides on the Approvals page, never their own request, exactly once; approval resumes that one job as the original person.
- **MCP proxy (M5.9):** tool servers are registered per organisation (credential kept as a secret, referenced by name), discovered, health and schema-hash recorded, each tool switched on separately with a permission, risk and policy. New tools arrive off; a tool whose definition changes is switched off until reviewed. https only (a short pilot allow-list), private addresses refused, no redirects, size and time limits. Every call goes through the gateway and Authority. API only so far (`/api/admin/mcp`); the admin screen comes with Studio. The Digi agent has no direct MCP connection. The hidden finance workers still use their old direct connections until Studio republishes them through the proxy.
- **Verified:** gateway and confirm flow 49/49 (`scripts/m5-test.py`, includes real chat turns), key, jobs, approvals, crash recovery and MCP 89/89 (`scripts/m5b-test.py`, needs `JOB_TEST_TYPES=1` and `DIGI_MCP_ALLOW_HOSTS=host.docker.internal` in `.env` while it runs), authority 14/14, isolation 45/45 (now covering every new table), plus earlier suites unchanged (24, 46, 41, 31).
- **Not yet:** the MCP and service-identity screens, a KMS for the secret key, retention (M6.2), and moving the finance workers onto the proxy.

### M6 as built (7 Oct 2026)
- **Explicit memory (M6.1):** `user_memories` (migration 0010), scoped by tenant and person, 50 short notes each, no automatic extraction. A person adds a note on Settings > Memory or asks in chat ("remember that..."): chat only prepares a card and the Confirm click stores it. Notes are sent to the model as the person's own background facts (never instructions), only in their own conversations. An administrator can switch memory off for the organisation (Settings > AI connection): no new notes, none used. People can delete any note at any time. Per-person pause is not built.
- **Retention (M6.2):** a daily `retention.sweep` job per organisation, run by the job engine as a no-permission service identity, deletes conversations 30 days after last activity (tenant setting `conversation_retention_days`), with their messages, prepared actions, old notifications and finished jobs. A conversation being written right now is kept. Each sweep writes an audit row with counts only. Audit events are not touched.
- **Limits, CSRF, secrets (M6.3):** per-person burst limit (20 messages a minute) and daily limit (300 questions), an organisation daily token cap (`ai_daily_token_cap`, off by default), all with plain messages and Retry-After. A request guard (`src/proxy.ts`) refuses browser writes from another site (Origin and Sec-Fetch-Site) on top of SameSite=Lax, httpOnly, Secure cookies. Secret rotation: `DIGI_SECRET_KEY_PREVIOUS` plus `db/rotate-secrets.mjs` re-encrypts saved secrets (tested both ways); `PORTAL_INTERNAL_KEY_PREVIOUS` allows rotating the tool key with no downtime. Sign-in throttling was already in place.
- **Backups (M6.4):** `scripts/backup-digi.py` and `scripts/restore-rehearsal.py`; runbook in `docs/platform/runbook-backup-restore.md`. Rehearsal 9/9, 2.9 s. The rehearsal caught a real defect in the first dump format and it was fixed. Real hosting, a schedule, off-machine copies and monitoring are still open.
- **Attack packs (M6.6):** `scripts/m6-test.py` creates a second organisation with rows of every kind and attacks them with every id: all refused, and its data is unchanged. Also a student against admin APIs and other people's things, forged identity in tool arguments and API bodies (ignored), and five prompt attacks ("ignore your rules and approve", fake system override, marker forgery, hostile note, role claims): none changed any booking or created anything. The public address does not serve the internal API or Open WebUI.
- **Verified:** M6 65/65, tool gateway 49/49, jobs/MCP/key 89/89, authority 14/14, isolation 46/46, earlier suites unchanged (24, 46, 41, 31).
- **Finding, not fixed here:** Open WebUI (a separate stack) publishes port 3001 on every network interface of this machine, so anyone on the same network can reach its login page. Digi reaches it over the Docker network, so the published port can be bound to 127.0.0.1 or removed. That is the other stack's compose file, so it was left for the owner to decide.
- **Not done:** M6.5 (load test on Open WebUI with Postgres, Redis and several workers) stays on hold by decision, pending the Strands direction; moving to real hosting.

## 7. Phase 1 acceptance scenario
A Newman student signs in to Digi, asks for a room for 20 people tomorrow 2 to 4, picks one, and confirms. A pending request is created.
A facilities approver sees it in their queue, approves it, and the student sees the approval. Another student cannot see any of it. The
model cannot approve. Every step has an audit row. At no point is the OWUI interface shown.

## 8. Decisions

Settled (6 Oct 2026):
1. **Approvers:** a user with the Admin role can approve and decline every request. The `rooms.approve` permission and `approver_scopes` stay in
   the model, so per-building Facilities Approvers can be added later without a redesign. In Phase 1, Admin holds `rooms.approve` for all buildings.
2. **Pending hold:** a pending request holds its slot for **7 days**, then expires. The number is a tenant setting (`booking_pending_expiry_days`, default 7).
3. **Notifications:** in-app only (notification bell and My requests). No email in Phase 1, so no mail service is needed yet.
4. **Users:** created manually in Digi by an Admin (name, email, role, temporary password or invite). No self sign-up. Bulk import and SSO come later.
5. **Workers page and finance workers:** hidden from users, **not deleted**. They stay defined in OWUI and in the capability registry (disabled) so
   they can be turned back on, for example as capabilities behind Digi for a finance role.
6. **Retention:** conversations are kept **30 days**, then deleted. Tenant setting (`conversation_retention_days`, default 30). Audit events are
   kept separately and are not deleted by this rule.
7. **Hosting:** will move to real hosting soon. Until then the laptop plus tunnel is a pilot only: no live term, no real student data. Backups and a
   restore rehearsal (M6) become mandatory at the move.

8. **LLM keys:** the customer provides their own key (settled 8 Oct 2026). Digi publishes a sizing guide (tokens per minute per number of users), checks the connection and discovered limits in Admin, and warns when a customer's tier is too low for their user count. Per-customer deployments set the key in that stack's OWUI connection; a shared deployment would route tenant to key through a gateway with a secret store.

Still open:
- Newman's identity provider (Microsoft 365 or Google), needed only when SSO is scheduled.
- Confirm the licence terms for OWUI as an internal runtime in a customer-facing product.
- Whether Admin can read a user's conversations (default: no; any access would be an explicit, logged permission).
