# S0 spike result (7 Oct 2026): PASS

Question: with one shared Open WebUI (OWUI) runtime account, can a Digi tool recover the real Digi user for each turn?

Setup: OWUI 0.11.3, account `digi-runtime` (role user), model `digi`, a Python tool `digi_s0_whoami` that posts the chat id OWUI gives it to a
Digi gateway (here a small Node server, `run.mjs`). Digi creates an execution context per turn (random `local:exec-<192 bits>` id, 120 s TTL,
bound to the real user) and uses that id as the OWUI `chat_id`.

| Check | Result |
|---|---|
| Alice and Bob run turns at the same time through the same runtime account | Gateway resolved each to the correct user. OWUI only ever saw `digi-runtime`. |
| Tool receives the chat id intact in `__metadata__` | Yes (also message_id, session_id, runtime user_id) |
| Unknown chat id / wrong internal key / expired context / missing chat id | 404 / 401 / 410 / 404 |
| Model's final reply, two users at once (3 runs) | Alice's reply named alice@newmanu.edu and not Bob; Bob's named bob@newmanu.edu and not Alice; neither mentioned the runtime account |
| OWUI persisted chats for the runtime user | 0 (the `local:` prefix is not saved). No `exec-` rows in OWUI's chat table |
| OWUI memories for the runtime user | none; user memory setting is unset |

Observed: two of the earlier runs failed to open the OWUI websocket (client timeout, cause not found); with a retry in the client, three consecutive runs passed with connects of 30 to 140 ms. The Digi OWUI client needs connect retries.

Not proved: latency, behaviour under load, OpenAPI or MCP tool servers (they get no
`__metadata__`; they would need forwarded headers, so MCP integrations use tenant service credentials and Digi-side gating), and behaviour under
load. The tool is a Python shim that lives inside OWUI and calls the gateway.

Design consequences: A1 is confirmed. Execution ids must start with `local:` to stay non-persistent. The tool takes no identity arguments, so the
model cannot supply or change identity. Short TTL matters because the id appears in OWUI logs.

Re-run: `python spikes/s0/install.py` then `node spikes/s0/run.mjs` (needs `.spike-runtime.json` with the runtime token; delete it after use).
