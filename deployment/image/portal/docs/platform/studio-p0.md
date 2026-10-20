# Studio P0: as built and how to run it (7 Oct 2026)

Studio P0 is done when a platform operator can create a Worker from plain English, register tools, set allow/ask/deny, test it, review and publish a
signed bundle, and a customer stack pulls, installs and runs it on Open WebUI, with customers unable to see Studio. All of that works and is tested.
Design: `architecture-v0.4.md`. Nothing from `strands_studio_ui` was copied (ST.0 is not triggered: P0 has no canvas).

## 1. Two instances, one codebase

| | Customer stack (`portal`, port 3100) | Platform instance (`studio`, 127.0.0.1:3200, never in the tunnel) |
|---|---|---|
| Role | `DIGI_ROLE=customer` | `DIGI_ROLE=platform` |
| Databases | `digi` (Newman) | `studio` (the platform realm) and `digitest` (the platform test stack: invented university, four personas) |
| Serves | the product | the product on the test stack, plus `/platform` (Studio), `/api/platform/*` and `/api/release/*` |
| Studio/release paths | **404** (`src/proxy.ts`): a customer cannot tell they exist | served |
| Identity | customer users, roles, `digi_session` | platform operators, TOTP MFA, `studio_session` (a different cookie, database and role) |

Platform permissions are not in the customer's catalogue at all, and the `permissions.scope` column only allows `customer`, so nothing platform-side can be
granted from a customer's Permissions page.

## 2. First-time setup (already done on this machine)
1. `python scripts/studio-setup.py` creates the `studio` and `digitest` databases, roles `studio_owner` and `studio_app`, and the secrets in `.env`.
2. Key ceremony, on a trusted machine (`scripts/studio-keys.mjs`): `init-root` (two passphrases, two people), `issue-release rk-<name>`. The root **public** key is
   `trust/root.pub.json` and ships in the image; the release key and its certificate go in `DIGI_KEYS_DIR` (outside the repository), mounted read-only into
   Studio only. **Pilot caveat:** I generated the root key and its two passphrases (`C:\Users\sridh\digi-keys\root\PILOT-PASSPHRASES.txt`). Before real use: split
   the passphrases between two people, run `rewrap-root`, move `root/` offline, delete that file.
3. `docker compose exec -T studio node db/studio-seed-operator.mjs <email> "<name>" platform_admin > .studio-credentials.txt` (password is random; you set up
   the authenticator on first sign-in). The first operator, koneru.sridhar@gmail.com, exists; its password is in `.studio-credentials.txt` (delete it after use).
4. Open WebUI tool modules for the test stack: `python scripts/install-digi-tools.py --prefix t_ --portal-url http://digiworks-studio:3000 --key-name STUDIO_INTERNAL_KEY`.

## 3. The flow
1. **Build** (`/platform`): describe a Worker in plain English (the builder returns a schema-valid **draft** only), or write the spec. Tools come from the
   catalogue (what a Digi stack really provides); a tool without a permission cannot exist. The Room Booking Worker is waiting as a draft
   (`studio/workers/room-booking.json`).
2. **Test** (Test Lab): run the draft as Test Student, Faculty, Registrar or Department Admin on the test stack, with their real permissions, through the real
   chat path, gateway, Authority and job engine. The trace shows tools offered, each call with Authority's decision, what was prepared, and what is waiting for
   another person (an approver persona can decide it). A test run never touches a customer database.
3. **Review** (mandatory): a person ticks instructions, tools and authority. The review is bound to the spec's hash; any later edit invalidates it. A published
   version is frozen by a database trigger, with a dependency lock naming the exact version and hash of every tool, skill, policy and model profile.
4. **Release** (platform admin): signs a bundle (manifest, workers, skills, policies, tool and model requirements, schemas, lock) with the release key. Checked
   before signing for secrets, customer data, endpoints and role mappings. Signing is audited. Channels stable/preview; a release can be marked security-critical.
5. **Enrol** (Installations): an admin mints a single-use, expiring token; the customer's Admin enters it on **Settings > AI updates**. The stack generates its own
   keypair and sends only the public key; it believes the platform's credential only after verifying it against the trusted root.
6. **Pull** (hourly, or Check now): signed client assertions (60 s, one use, bound to method and path), no shared key. Revocations first, then the newest release.
7. **Install**: signature chain, revocation, anti-rollback, Digi version, runtime features, content rules, valid specs, a consistent lock, and tool contracts
   (a bundle cannot understate a tool's risk or name a different permission than the stack's own). Then it waits for the Admin (default), installs itself, or waits
   out the security grace period, by the customer's setting. It is bound to the customer's own model, compiled by the runtime adapter, and activated. A failed
   install leaves the previous release running. **Rollback** moves the active pointer to the previous release (no platform call).
8. **Use**: one Digi agent. The Capability Router narrows per turn: installed, on for the App, on for the person's role (`capability.<id>.use` under "AI
   Capabilities" on Settings > Permissions), then keywords, staying with the Worker already helping. If nothing matches, Digi answers on its own. The Worker's
   own policy narrows the person's permissions at the tool gateway and never widens them. Customers see capabilities, never instructions, models or Studio.

## 4. Decisions taken while building (against the open questions in v0.4 section 12)
- **Signature algorithm: ES256** (ECDSA P-256), recorded in every signature; KMS products all offer it. The signer is an interface; production selects a KMS
  signer. The pilot uses a file signer.
- **Revoked release already running:** the stack alerts the Admins and falls back to the previous good release; with none, it switches the Workers off. A
  security-critical release installs by itself after 7 days, set by platform policy.
- **Anti-rollback:** each release carries `min_allowed_seq` (the newest security-critical release); the stack refuses anything older.
- **What an App is:** a surface a capability can be switched on or off for (Digi chat in the portal, an assistant on the Bookings page). Table `apps`; per-tenant
  switches in `tenant_app_capabilities`; no row means on. Available = installed, on for the App, on for the role, and permitted by the person's real permissions.
- **Revocation list** is signed by the release key and believed only if that key chains to the root and has not itself been revoked; a **key** revocation is signed
  by the root at the ceremony (`revoke-key`) and verified again on import.
- **Test stack = the customer code on its own database**, not a separate product, so Workers are tested exactly as they run. Open WebUI is shared, so compiled
  Workers carry a `stack:<id>` tag and tool modules a `t_` prefix on the test stack, and a compiled Worker never appears on the Workers page.
- **MCP tools in a bundle** are refused for now ("needs a tool connection"): binding them to the customer's MCP proxy comes with the first Worker that needs one.
- **Mutual TLS** was not built; signed client assertions are the specified fallback and are in place.
- **AG-UI** as the execution-event vocabulary was not adopted: the existing SSE events (meta, queued, tool, embed, text, action, done, error) carry what P0 needs.

## 5. Tests
| Suite | What it proves | Result |
|---|---|---|
| `scripts/m7a-test.py` | operator login and MFA (replay refused, password alone refused), realm separation, spec validation, immutability, review gate, audit | 66/66 |
| `scripts/m7b-test.py` | signing, enrolment, signed assertions, pull, install, router and role/App switches, Worker policy at the gateway, the override that needs another person, tampered / foreign-signed / over-claiming / unsupported bundles, pin, auto, grace period, rollback, release and installation revocation | 112/112 |
| `scripts/m7c-test.py` | the plain-English builder (including an injected request), the Test Lab as four personas, the ask-then-approve path | 35/35 |
| `scripts/release-test.mjs` | 41 unit tests: trust chain, assertions, specs, effective policy, router |
| earlier suites | unchanged: sign-in 24, permissions 46, conversations 41, bookings 31, gateway 49, jobs/MCP/key 89, attacks 65, authority 14, isolation 47 | all pass |

`m7b-test.py` resets this stack's enrolment (it is destructive); run it on the pilot only.

## 6. Limits and next steps
- The Test Lab returns the whole trace when a run ends (not streamed live).
- Studio has no screens yet for creating Policies, Skills, or MCP tools (the API has them); the catalogue page is read-only.
- Production needs: a KMS signer, real hosting for the platform instance with the Release Service on a public https address (`DIGI_RELEASE_ALLOW_HOSTS` is for the
  pilot only), root passphrases held by two people, and enrolment tokens handed over out of band.
- Next: `STR`, the Strands adapter, to run the same bundle (needs a verified SDK feature list first); then Studio P1 (workflows, visual editor), where the licence
  gate (ST.0) applies.
