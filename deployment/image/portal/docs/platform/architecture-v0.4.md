# Digi platform architecture (proposal v0.4): Studio, release bundles, routing

Status: decisions locked 7 Oct 2026 after reviewing the "DigiWorks Studio: Runtime-Agnostic Implementation Specification". Design; **Studio P0 is built (7 Oct 2026): see `studio-p0.md`** for what exists, how to run it, and the decisions taken below. It extends `architecture-v0.3.md`, which still stands, and changes only what is listed in section 8.

## 1. Shape

```
CENTRAL, PLATFORM ONLY                              CUSTOMER STACK (one per customer)
 Studio                                              Digi portal (Next.js)
  Worker / workflow builder, Skills, Tools            Digi agent  ->  Capability Router  ->  Worker
  Canonical specs, Test Lab (own test stack)          Runtime Adapter: OWUI (first), Strands (second)
  Release management, signing                         Tool Gateway + Authority + MCP proxy
        |                                             Durable job engine
        |  signed, versioned release bundle           Domain services (Academics ...)
        +----- customer stack pulls over HTTPS -----> OWUI, private
```

Studio builds and signs portable Digi release bundles. Each customer stack pulls, verifies, binds, compiles and runs them independently.
Published Workers run with Studio switched off. Studio is a separate realm, not a customer-visible feature.

## 2. Release bundle contract (locked)

A bundle is product definition only, never customer configuration or secrets.

```
manifest.json   release_id, digi_min_version, runtime_capabilities, required_tools, required_model_profiles
workers/  skills/  workflows/  policies/  tool-requirements/  model-requirements/  schemas/
lock.json       exact versions of every Worker, Skill, Policy, Tool contract and Workflow in the release
```

- `lock.json` resolves the dependency problem found in review: a published Worker can never silently change because a Skill or Tool changed.
- A bundle must not contain LLM keys, MCP credentials, database credentials, OAuth tokens, customer role mappings, customer users,
  tenant-specific endpoints or customer data. The customer stack binds those locally (the customer's LLM key stays decision A14).
- **Install flow:** signature check, compatibility check, dependency validation, local binding, `adapter.compile()`, `activate`.
  A bundle that needs a capability the installed adapter lacks (for example `agent_handoff` on OWUI) is rejected before activation.
- Adapter contract: `capabilities()`, `validate(bundle)`, `compile(bundle, local_bindings)`, `activate(compiled_release)`.

## 3. Delivery: customer stacks pull (locked)

- Outbound HTTPS only: `GET /releases/{channel}/latest`, channels `stable`, `preview`, `pinned`. The stack sends only its installation id,
  current release, Digi version and runtime capabilities. No customer data leaves the stack.
- Customer setting for updates: apply compatible releases automatically, **require customer Admin approval (default)**, or pin the current release.
- **Rollback** moves the active-release pointer to the previous installed release. It does not rebuild a bundle.
- Added in review: each installation authenticates to the Release Service (per-install credential or mutual TLS); the stack refuses an older
  release than its minimum allowed id (anti-rollback) and any release whose key has been revoked.

## 4. Signing (locked)

- Asymmetric. Offline **root key** signs the **release signing key**, which signs bundles. The private release key lives in a KMS or HSM, never in
  `.env`, a database, an image or source control. Customer stacks ship with trusted public keys; bundle metadata carries `key_id`, `digest`,
  `signature`, `signed_at`. This allows key rotation without reinstalling stacks.
- Added in review: a signed revocation list, and signing events audited centrally.

## 5. Test Lab (locked)

Studio never tests against a customer stack or data. A **platform test stack** mirrors the customer architecture (runtime service, OWUI, Strands,
gateway, jobs, sandbox Academics, synthetic database) with synthetic personas such as Test Student, Registrar, Advisor and Department Admin, so
a Worker is tested as each role would use it, not only for the quality of its answers.

## 6. One Digi, many Workers (locked)

- Customers use **one Digi agent**. Studio can create many Workers behind it (Admissions, Scheduling, Student Finance, Room Booking, Reporting).
- The **Capability Router** is a platform component, not another autonomous agent. It narrows deterministically: enabled Workers, then app
  scope, then the user's permissions, then intent and Worker capability metadata. An LLM chooses only when several valid Workers remain.
- Customers see **AI Capabilities**, not Workers. On Settings → Permissions they switch capabilities on or off per role (and possibly per app).
  They never see instructions, prompts, model internals, workflow implementation, runtime configuration, Studio, Strands or OWUI.
- Mechanism: each installed capability registers a permission in a new "AI Capabilities" module, so the existing role/permission model governs it.

## 7. Platform identity (locked)

Two separate realms. **Platform** (operator, platform admin, Studio, releases, signing) and **customer stack** (Admin, Registrar, Advisor, Student).
A customer Admin has no authority over platform identities. Separate API namespaces: `/platform/*` and `/api/*`, in one codebase at first.
Studio needs a platform identity, a platform role and MFA, and can never be granted through customer permissions (the permission catalog gets a
scope: platform permissions are not assignable from a customer's Permissions page).

## 8. Changes to the build plan

| Milestone | Change |
|---|---|
| **M3** | `OWUIClient` becomes `RuntimeAdapter` with `OWUIRuntimeAdapter` as implementation 1: `capabilities()`, `validate`, `compile_worker`, `start_execution`, `continue_execution`, `stream_execution`, `cancel_execution`, `create_session`, `load_context`. The runtime-account pool, multiplexed sockets, retries and admission control (A11, A12) sit inside the OWUI adapter. |
| **M4** | Unchanged: the booking application work. |
| **M5** | Three separate components that interact: **Tool Gateway** (native tools, OpenAPI, MCP proxy), **Authority** (user and service identity; effective permission = role grants, intersected with Worker policy, intersected with Tool policy; allow / ask / deny), **Durable Job Engine** (queue, worker processes, checkpoints, retries, approvals, resume). |
| **Studio foundation** | After M5: platform identity and MFA, canonical specs with dependency lock, Studio tables, platform test stack, signing, Release Service, customer installer, router. |
| **Studio P0** | Create a Worker, registered tools, allow/ask/deny, test, human review, publish a signed bundle, customer pull and install, OWUI compile and run. |
| **Strands** | `StrandsRuntimeAdapter` using the same bundle and specs, with capability validation: the portability proof. |
| **Studio P1+** | Workflows, automations, advanced memory, knowledge, multi-agent, visual editor. |

Full Studio does not start before M5. M3 and M5 lay the foundation so Studio is an authoring and release control plane, not a redesign.

## 9. Notes from the review that shape the design

- **ASK has two meanings.** The actor confirming their own action (A3, confirm in the Digi UI) is not the same as a policy making another person
  approve it (an approver with `bookings.approve`). The job engine's `WAITING_APPROVAL` state is the second one; both write audit rows.
- **OWUI's capability report must match what we run.** OWUI reports persistent memory as not provided: conversation context and memory come from Digi
  (A5, A7), not OWUI's own memory.
- **MCP through the proxy only.** A runtime that talks to an MCP server directly would bypass Authority. Spike S0 also showed OpenAPI and MCP tool
  servers get no chat id from OWUI, so the OWUI adapter keeps a thin Python tool shim until a forwarded-header route is verified.
- **Routing is the hard part.** Deterministic intent matching is brittle. Start with app context and permissions, add LLM selection for ties.
- **Domain state machines stay in domain services** (for example Academics plan approval). Workflows call them as tools; they do not re-implement them.
- **Permission catalog today is static and seeded by migrations.** Installing a bundle needs a controlled way to add capability permissions.
- **Checked 7 Oct 2026** (GitHub API and page summaries; feature claims still unverified): the Strands SDK repo `strands-agents/harness-sdk` (also reached as `sdk-python`) is Apache-2.0 and very active. The standalone `sdk-typescript` repo is archived, so assume Python for the Strands adapter until TypeScript support is confirmed. `xiehust/strands_studio_ui` (63 stars, last push July 2026) and `ryancormack/strands-agents-ui` (a one-commit proof of concept) both have **no licence**, so their code cannot be copied. They are functional references only; implement any UI clean-room, using the XYFlow library directly (confirm its licence). The second repo's AG-UI event protocol is worth evaluating as the normalized execution-event vocabulary.

## 10. Locked 7 Oct 2026 (second round)

1. **Signing keys.** The release signing key lives in the central platform's HSM-backed managed KMS, kept provider-neutral (Azure Key Vault, AWS KMS and so on) so bundles do not change. The root key stays offline, used only to authorize and rotate release-signing keys, and needs **two designated platform operators** for any root operation. Studio never holds the root key. *Added:* the bundle format carries a signature-algorithm field, because KMS products differ in which algorithms they support (ECDSA P-256 and RSA are widely available; Ed25519 is not).
2. **Installation identity.** Each customer stack has its own cryptographic identity. First install uses a one-time enrollment token; the stack generates its keypair locally, sends only the public key, and receives an `installation_id` and a platform-signed credential. After that it authenticates outbound pulls with mTLS or signed client assertions. No shared API key. Secrets stay in the stack. *Added:* tokens are single-use and expire; a lost-key re-enrollment path; credentials are revocable; signed client assertions are the fallback where a customer's outbound proxy breaks mTLS.
3. **Security-critical releases.** Customers can delay normal releases indefinitely by pinning. A security-critical release has a maximum grace period of **7 days**, set by Digi policy, not by the customer. A revoked release is announced in a signed revocation notice and the stack refuses to newly activate it. Ordinary feature releases are never forced. *Added, to settle:* what a stack does with a revoked release that is already running (alert and fall back to the previous good release is my proposal), and what happens when a forced release is incompatible with the customer's Digi version (they must be told, and a core upgrade path is needed).
4. **First Studio Worker: Room Booking.** Search rooms (read), check availability (read), propose a booking, create the reservation (write) through the Tool Gateway to the room service. It will also run unchanged on Strands as the portability proof. *Added:* creating a booking request is the person confirming their own action; the approver deciding it stays a human action in the UI, not a Worker tool. So to exercise Authority's ASK and the job engine's approval and resume, the P0 Worker also needs one action that requires another person's approval, such as "override a conflict".
5. **Capabilities are controlled by App and Role.** Available to Digi = installed, enabled for the App, enabled for the Role, and permitted by the user's actual permissions. A Worker can never widen the user's domain permissions. Studio publishes capabilities; the customer stack decides who uses them. *Added:* we have no App concept yet. Implementation proposal: each capability registers a role-level permission (`capability.<id>.use`), a separate app-enablement table holds the per-app switch, and domain permissions are checked at tool time. Apps need to be defined (a surface or context, not just a role).

## 11. Licence gate for the Studio UI base (7 Oct 2026)

The plan is to build Studio on `xiehust/strands_studio_ui`. GitHub reports **no licence** for that repository. With no licence, copyright stays with the author: its code cannot be copied, forked into a product or modified without written permission. Two routes, which can run in parallel:
1. **Ask the author for an explicit licence** (MIT or Apache-2.0 is what we need, covering commercial use) or a written grant. Until it is in hand, no source is copied into Digi.
2. **Clean-room.** Use the repository only to see what the UI does, and build the canvas, node editors and property panels ourselves on the XYFlow library (confirm its licence) against Digi's APIs.
Either way, most of that project is not reusable as it stands (generated Python as the source of truth, browser-local project storage, file-based sessions, AWS deployment paths), and the spec already says to rewrite those. What remains useful is the canvas and editor look and behaviour, which is workflow editing: Studio P1, not P0. So the licence does **not** block P0, M3 or M5. It also carries single-maintainer risk (63 stars, an independent project, not an Amazon product).

## 12. Still open

1. Signature algorithm choice and the exact KMS provider.
2. Behaviour for a running release that is later revoked, and for an incompatible forced security release.
3. The definition of an "App" (separate surfaces, or contexts inside one portal).
4. The AG-UI protocol as the normalized event vocabulary (to evaluate).
5. Whether the Strands TypeScript SDK is merged into the main repo.

## 13. Resolved while building P0 (7 Oct 2026)
1. Signature algorithm: ES256 (ECDSA P-256), declared in every signature; the KMS signer is an interface, the pilot uses a file signer.
2. A revoked release that is running: alert the Admins and fall back to the previous good release (switch the Workers off if there is none). A security-critical release installs after 7 days.
3. An App is a surface a capability can be switched on or off for (`apps`, `tenant_app_capabilities`); default on; available = installed, on for the App, on for the role, permitted by the person.
4. AG-UI was not adopted for P0; the existing event stream is enough.
5. Strands SDK feature claims are still to be verified before the Strands adapter (STR).
