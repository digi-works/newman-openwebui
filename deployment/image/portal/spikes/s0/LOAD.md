# S0 load probe (8 Oct 2026)

Setup: one OWUI container (1 worker, SQLite, no Redis), one shared runtime account, model `digi`, a one-word prompt, no tools, laptop host (10 cores).
Each turn opens its own websocket plus an HTTP completion, as the portal does today. `node spikes/s0/load.mjs 1 8 25 100`.

| Concurrent turns | Succeeded | Turn time p50 / p95 | Connect p95 | Events received for OTHER chats, per socket |
|---|---|---|---|---|
| 1 | 1 | 3.5 s | 0.3 s | 0 |
| 8 | 8 | 3.5 s / 4.3 s | 0.16 s | 77 |
| 25 (run 1) | 25 | 32 s / 33 s | 0.22 s | 260 |
| 25 (run 2) | 25 | 3.7 s / 4.9 s | 0.12 s | 222 |
| 100 | 88 (12 failed: "fetch failed") | 36.5 s / 37.3 s | 1.1 s | 724 |

Findings
- Every socket on the shared account receives every chat's events. Cross-chat traffic is about 7 events per concurrent chat per socket, so total deliveries grow with the square of concurrency. This is also a confidentiality reason to keep these sockets server-side only.
- OWUI CPU peaked above 1000% (several cores) at 100 turns on one worker.
- The 25-turn result was inconsistent (32 s once, 3.7 s once), so the cause of that stall is not established. It could be OWUI or the model provider; this probe did not separate them.
- Not tested: tools, long answers, a real provider quota, 1000 turns, the portal and database under load. 1000 is an extrapolation, not a measurement.

## After M3 (8 Oct 2026): through the portal, real people, real tools
Setup: portal with the pooled, multiplexed OWUI adapter (3 runtime accounts, one persistent socket each), admission control, server-side conversations.
Each person sends one short turn at the same moment (`python scripts/m3-load.py 40 80`). The Digi model's tools are attached, unlike the earlier probe.

| People at once | Admission cap | Result | Turn time p50 / p95 | Wall |
|---|---|---|---|---|
| 40 | 40 | 40 of 40 succeeded | 33 s / 35 s | 35 s |
| 80 | 40 | 80 of 80 succeeded (40 queued) | 42 s / 44 s | 45 s |
| 40 | 10 | 40 of 40 succeeded (30 queued) | 27 s / 31 s | 31 s |

Findings
- Failures dropped from 12 of 100 to 0 of 80. Queued people waited, and nobody saw a timeout.
- Throughput stayed near 1.2 to 1.3 turns per second whatever the cap, so the ceiling is now OWUI (one worker, SQLite) and the model, not Digi. A lower cap gave only a modest gain, so the default is 12 and it is tunable (ADMISSION_GLOBAL).
- Likely contributors, not isolated: OWUI loading the tool code on every request on a single worker, and the model provider. The fix for the first is A13 (Postgres, Redis, several workers).
- Not tested: more than 80 people, long answers, real hosting, or a customer's own provider tier.
