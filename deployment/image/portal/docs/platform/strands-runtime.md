# Strands runtime adapter: as built (8 Oct 2026)

Decisions (7 to 8 Oct): the runtime is chosen **per stack** by the stack's Admin. **Open WebUI stays the default** until Strands has been completely tested. The
licence request for `strands_studio_ui` is parked; nothing from that project is used here.

## What exists
- **`strands-runtime/`**: a small Python service (Strands Agents 1.58.1, Apache-2.0, pinned) on the private Docker network, with no published port and a required
  `X-Runtime-Key`. For each turn Digi sends the instructions, the tools allowed that turn, the conversation, the model access and the gateway address. The service
  builds a Strands agent for that turn, streams events back, and keeps nothing afterwards (no sessions, memory or keys).
- **Tools go through Digi, not around it**: each tool the agent calls is a call to Digi's tool gateway with the per-turn handle, exactly like the Open WebUI tool
  modules. So Authority, confirm cards, approvals, the job engine, the audit trail and Worker policy are identical on both runtimes. The service never decides who
  someone is. Forms and room lists come from the gateway as embeds (`src/lib/tools/embeds.ts`), so the chat view is unchanged.
- **`StrandsRuntimeAdapter`** implements the same `RuntimeAdapter` contract as Open WebUI (capabilities, health, compile, complete, startExecution). It declares
  `chat`, `streaming` and `tools`; it declares **no** `mcp`, `agent_handoff`, `graph_workflow` or runtime-held memory, so a release that needs them is refused.
  "Compile" for Strands is Digi's own definition of the Worker, stored with the installed Worker (`installed_workers.runtime_def`).
- **Per-stack choice**: `stack_identity.runtime` (`owui` or `strands`), read with a 3 second cache. Settings > AI connection shows each runtime's health and what it
  can run, and the switch.
- **A switch is checked before it happens**: the target must be healthy, must support every runtime feature the installed Workers need, and must answer a real test
  turn with this organisation's model access; only then are the Workers recompiled and the setting flipped. Any failure leaves the current runtime untouched.
  Switching back is the same action. Digi's data (people, permissions, conversations, bookings, memory, approvals, audit) never lived in a runtime, so it does not move.
- **Model access**: the AI key saved on Settings > AI connection is sent to the service for the turn only (server to server). `STRANDS_MODEL_*` in the environment
  override it (tests, pilot). If neither exists the person sees a plain "No AI key is saved yet" message and an Admin sees it in the switch test.

## What I found
- Open WebUI's `/api/chat/completions` streams Responses-format events for this connection, which the Strands OpenAI client cannot read, and its pass-through is off.
  So the Strands service calls the provider directly with the customer's key, as the design intended.
- A Worker's instructions use the tool names people already know (`request_room` and so on), so the same prompts work on either runtime.
- `OwuiRuntimeAdapter.health()` reported 0 accounts right after a restart because its sockets connect on first use. It now connects one first.

## Tests
`scripts/m8-test.py` uses a scripted local model (`scripts/_mock_llm.py`), so it needs no key. 31 checks: the service refuses a caller without its key and has no
published port; the switch is admin-only, audited, and refused when the model cannot answer, or when installed capabilities need a feature Strands lacks; a turn
streams on Strands with tool events, a gateway tool-call row, runtime-reported token counts, only the person's tools offered under the usual names, and Digi's own
instructions and context; forms and lists arrive as embeds; a write only prepares a card and "yes" in chat commits nothing, while the Confirm click does; 30 turns from
10 people at once all complete; the whole signed-release flow (`m7b-test.py`, 109 checks, run with the stack on Strands) passes; switching back to Open WebUI runs a
real turn. Result: all pass (the one early failure was a wrong expectation: a tool turn makes two model calls, so 240 tokens in, not 120).

**Load note**: with the scripted 0.4 second model, 30 turns completed in 5.3 seconds (5.6 turns/s) through Digi's admission control. That measures the runtime
overhead, not a real provider, so it is not a like-for-like comparison with the Open WebUI probe (about 1.2 turns/s); repeat it with the customer's real key.

## Not done
- A live check against the real model (needs the AI key saved on Settings > AI connection), then the same load probe with it.
- Strands is not offered the MCP proxy through a Strands MCP client; MCP tools work only through Digi's gateway as ordinary tools.
- Multi-agent, graph workflows and runtime-held memory (declared unsupported until built).
- Studio's Test Lab uses whatever runtime the platform test stack is set to (Open WebUI today).
- Open WebUI stays installed and is the default until Strands has been through the real-key tests and a pilot period.
