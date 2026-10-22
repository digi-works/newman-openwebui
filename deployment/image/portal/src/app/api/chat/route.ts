import { admission, BusyError } from "@/lib/admission";
import { classifyAiFailure, noteAiFailure } from "@/lib/ai-connection";
import { finishRun, startRun } from "@/lib/ai-runs";
import { checkChatLimits } from "@/lib/limits";
import { memoriesForContext } from "@/lib/memory";
import { actionsForConversation } from "@/lib/pending-actions";
import { isPlatform } from "@/lib/role";
import { modulePrefix } from "@/lib/stack/compose";
import { knownApp, routeTurn } from "@/lib/stack/router";
import { getWorker, workerPolicyOf, type InstalledWorker } from "@/lib/stack/workers";
import { toolsFor } from "@/lib/tools/rules";
import { buildContext } from "@/lib/context-builder";
import { conversationStore, isId } from "@/lib/conversations";
import { createExecutionContext } from "@/lib/exec-context";
import { trackTurn } from "@/lib/live-turns";
import { isLive, listOwuiAgents } from "@/lib/owui";
import { runtimeToken } from "@/lib/owui-runtime";
import { P } from "@/lib/permissions";
import { getRuntime } from "@/lib/runtime";
import { DIGI_SYSTEM } from "@/lib/runtime/digi-system";
import { toolDefinitions } from "@/lib/stack/definitions";
import { composeSystem } from "@/lib/stack/compose";
import { authLive, can, getSessionUser } from "@/lib/session";
import { getTenant } from "@/lib/tenant";

type Body = { conversationId?: unknown; text?: unknown; app?: unknown };
const bad = (error: string, status = 400) => Response.json({ error }, { status });
const SSE_HEADERS = { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" };
const FLUSH_MS = 1500;
const MAX_TEXT = 8000;
/** Tool modules that carry Digi tools. They are offered only as far as the person may use them (M5.5); the old single bundle id is still recognised. */
const DIGI_MODULES = new Set(["digi_rooms", "digi_bookings", "digi_approvals", "digi_mcp", "digi_memory", "digi_room_request"]) /* the last is the old single bundle */;

/** An answer that points the person at a confirmation card. Digi sometimes says so without calling the tool that makes one (QA: "Confirmation panel is not displayed"). */
const CLAIMS_CARD = /\b(press|click|tap)\W{0,3}confirm\b|\b(review|check|see|look for|find|appear)\b[^.]{0,40}confirmation (card|panel)/i;
const NO_CARD_NOTE = "\n\n_No confirmation card was prepared, so nothing is waiting for you to confirm yet. Reply **show the confirmation card** and Digi will prepare it._";

/** Hidden machine-readable blocks (<!--room-request {...}-->) that forms add for the worker. They are not part of a title. */
const titleFrom = (text: string) => {
  const t = text.replace(/<!--[\s\S]*?-->/g, "").trim().replace(/\s+/g, " ");
  return !t ? "Room request" : t.length > 44 ? t.slice(0, 44) + "…" : t;
};

/**
 * One AI turn in a conversation. The browser sends only the conversation id and the new message; Digi loads the history from its own
 * database, saves both messages, builds the request, runs it through the runtime adapter and streams events back. The answer is saved as
 * it arrives, so a dropped connection never loses what was already said. Stop (POST .../messages/<id>/stop) ends the turn and cuts the saved
 * answer to what the person saw.
 *
 * Events (server-sent): meta, queued, tool, embed, text, done, error.
 */
export async function POST(req: Request) {
  if (!isLive()) return bad("The AI service is not configured.", 503);
  const user = await getSessionUser();
  if (!user) return bad("Please sign in again.", 401);
  if (!can(user, P.chatUse)) return bad("You do not have access to chat with Digi.", 403);

  let body: Body;
  try { body = await req.json(); } catch { return bad("Invalid JSON."); }
  const { conversationId, text } = body;
  const app = typeof body.app === "string" ? body.app : "portal";
  if (!isId(conversationId) || typeof text !== "string" || !text.trim() || text.length > MAX_TEXT) return bad("Invalid request.");

  if (authLive()) {
    const limit = await checkChatLimits(user.tenantId, user.id).catch(() => ({ ok: true as const }));
    if (!limit.ok) return Response.json({ error: limit.message }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  }

  const owner = { id: user.id, tenantId: user.tenantId };
  const store = conversationStore();
  const conv = await store.get(owner, conversationId);
  if (!conv) return bad("Conversation not found.", 404);
  if (conv.messages.some((m) => m.status === "streaming")) return bad("Digi is still answering in this conversation.", 409);

  // The agent this conversation is with. A "lab:<worker>" conversation exists only on the platform test stack (the Test Lab). Otherwise only models the
  // portal exposes as agents may run, so this is not an open proxy to every model.
  const actor = { id: user.id, tenantId: user.tenantId, name: user.name, email: user.email, permissions: user.permissions };
  let toolIds: string[] = [];
  let model = conv.agentId;
  let routed: InstalledWorker | null = null;
  let workerId: string | undefined;
  const lab = conv.agentId.startsWith("lab:");
  if (lab) {
    if (!isPlatform()) return bad("Unknown agent.", 404);
    routed = await getWorker(conv.agentId.slice(4), true);
    if (!routed?.modelId) return bad("Unknown agent.", 404);
  } else {
    try {
      const agent = (await listOwuiAgents(await runtimeToken())).find((a) => a.id === conv.agentId);
      if (!agent) return bad("Unknown agent.", 404);
      toolIds = agent.toolIds ?? [];
    } catch {
      return bad("Could not reach the AI service.", 502);
    }
    // One Digi agent for people; the Capability Router picks an installed capability for this turn, or Digi answers on its own.
    if (authLive() && conv.agentId === "digi") {
      if (!(await knownApp(app))) return bad("Unknown app.");
      routed = (await routeTurn({ tenantId: user.tenantId, conversationId: conv.id, permissions: user.permissions, app, text })).worker;
    }
  }
  if (routed) { model = routed.modelId!; workerId = lab ? `lab:${routed.workerId}` : routed.workerId; }

  // Per-turn tool selection (M5.5): only the tool modules this person may use, narrowed by the Worker's own policy. The gateway checks again on every call.
  const offered = authLive() ? await toolsFor(actor, routed ? workerPolicyOf(routed) : undefined) : { toolIds: [] as string[], modules: [] as string[] };
  const runtime = await getRuntime();
  const modules = offered.modules.map((m) => modulePrefix() + m);
  if (routed) toolIds = modules;
  else if (toolIds.some((id) => DIGI_MODULES.has(id))) toolIds = [...toolIds.filter((id) => !DIGI_MODULES.has(id)), ...modules];

  if (conv.messageCount === 0) await store.patch(owner, conv.id, { title: titleFrom(text), clearPending: true });
  const userMsg = await store.addMessage(owner, conv.id, { role: "user", content: text, status: "done" });
  const asstMsg = await store.addMessage(owner, conv.id, { role: "assistant", content: "", status: "streaming" });
  if (!userMsg || !asstMsg) return bad("Conversation not found.", 404);

  const tenant = await getTenant();
  const memories = authLive() ? await memoriesForContext(user.tenantId, user.id).catch(() => []) : [];
  const messages = buildContext({
    memories,
    tenantName: tenant?.name ?? "your university",
    person: { name: user.name, roles: user.roles },
    history: [
      ...conv.messages.filter((m) => m.status !== "streaming" && m.text).map((m) => ({ role: m.role, content: m.text })),
      { role: "user" as const, content: text },
    ],
  });

  const enc = new TextEncoder();
  const ctl = new AbortController();
  req.signal.addEventListener("abort", () => ctl.abort(), { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: unknown) => { try { controller.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`)); } catch { /* the browser left */ } };
      let acc = "", label: string | undefined, dirty = false, status: "done" | "stopped" | "error" = "done";
      const embeds: string[] = [];
      let release: (() => void) | undefined;
      let flushing: Promise<unknown> = Promise.resolve();
      const flush = () => {
        if (!dirty) return;
        dirty = false;
        flushing = store.updateMessage(owner, conv.id, asstMsg.id, { content: acc, toolLabel: label ?? null, embeds }).catch(() => undefined);
      };
      // Stop from the browser: how much of the answer the person saw, so nothing they did not see is saved
      let shown: number | undefined, saving = false, markSaved = () => {};
      const untrack = trackTurn(asstMsg.id, {
        userId: user.id,
        stop: (n) => { if (saving) return false; shown = n; ctl.abort(); return true; },
        saved: new Promise<void>((r) => { markSaved = r; }),
      });
      const timer = setInterval(flush, FLUSH_MS);

      const t0 = Date.now();
      let runId: string | null = null, queueMs = 0, usage: { tokensIn?: number; tokensOut?: number } | undefined, failure: string | undefined;
      const sentActions = new Set<string>();
      const sendActions = async () => {
        for (const a of await actionsForConversation(user.tenantId, user.id, conv.id).catch(() => [])) {
          if (a.messageId === asstMsg.id && !sentActions.has(a.id + a.status)) { sentActions.add(a.id + a.status); send({ type: "action", action: a }); }
        }
      };

      send({ type: "meta", userMessageId: userMsg.id, assistantMessageId: asstMsg.id, title: conv.messageCount === 0 ? titleFrom(text) : conv.title });
      try {
        release = await admission().acquire(user.tenantId, user.id, { signal: ctl.signal, onPosition: (n) => send({ type: "queued", position: n }) });
        queueMs = Date.now() - t0;
        if (authLive()) {
          runId = await startRun({ tenantId: user.tenantId, userId: user.id, conversationId: conv.id, messageId: asstMsg.id, runtime: runtime.id, model, toolsAvailable: offered.toolIds, inputChars: text.length, workerId, app });
        }
        const executionId = authLive() ? await createExecutionContext(user.tenantId, user.id, { conversationId: conv.id, runId: runId ?? undefined, workerId }) : `local:demo-${crypto.randomUUID()}`;
        // What a runtime without agents of its own needs: the instructions and the tools allowed this turn (Open WebUI ignores it and uses the compiled model).
        const definition = runtime.id === "strands"
          ? { system: routed ? (routed.runtimeDef?.system ?? composeSystem(routed.spec, [])) : DIGI_SYSTEM, tools: await toolDefinitions(user.tenantId, offered.toolIds) }
          : undefined;
        for await (const ev of runtime.startExecution({ executionId, tenantId: user.tenantId, model, toolIds, definition, messages, signal: ctl.signal })) {
          if (ev.type === "text") { acc += ev.delta; dirty = true; send({ type: "text", delta: ev.delta }); }
          else if (ev.type === "tool" || ev.type === "status") { label = ev.type === "tool" ? ev.label : ev.text; dirty = true; send({ type: "tool", label }); if (authLive()) await sendActions(); }
          else if (ev.type === "embed") { embeds.push(ev.html); dirty = true; send({ type: "embed", html: ev.html }); }
          else if (ev.type === "failed") {
            // A provider problem (rate limit, rejected key) is the admin's to fix. People only see a plain message; the admin sees the alert.
            const kind = classifyAiFailure(ev.message);
            const shown = kind === "rate_limited" ? "AI quota is busy. Please try again in a minute." : kind === "key_rejected" ? "Digi cannot reach its AI provider right now. Please tell your administrator." : ev.message;
            if (kind && authLive()) void noteAiFailure(user.tenantId, kind);
            status = "error"; failure = ev.message; if (!acc) acc = shown; send({ type: "error", message: shown }); break;
          }
          else if (ev.type === "completed") { usage = ev.usage; break; }
        }
        // Never leave someone looking for a card that does not exist: if the answer points at one and none is waiting in this conversation, say so.
        if (status === "done" && !ctl.signal.aborted && authLive() && CLAIMS_CARD.test(acc)) {
          const waiting = (await actionsForConversation(user.tenantId, user.id, conv.id).catch(() => null))?.some((a) => a.status === "pending");
          if (waiting === false) { acc += NO_CARD_NOTE; dirty = true; send({ type: "text", delta: NO_CARD_NOTE }); }
        }
        if (ctl.signal.aborted) status = "stopped";
      } catch (e) {
        if (e instanceof BusyError) {
          status = "error";
          acc = acc || "Digi is busy right now. Please try again in a moment.";
          send({ type: "error", message: acc });
        } else if ((e as Error).name === "AbortError" || ctl.signal.aborted) {
          status = "stopped";
        } else {
          status = "error";
          acc = acc || "Sorry, something went wrong. Please try again.";
          send({ type: "error", message: acc });
        }
      } finally {
        clearInterval(timer);
        release?.();
        saving = true;
        if (shown !== undefined) { status = "stopped"; acc = acc.slice(0, shown); }
        await flushing;
        await store.updateMessage(owner, conv.id, asstMsg.id, { content: acc, status, toolLabel: label ?? null, embeds }).catch((e) => console.error("saving the answer failed", e));
        markSaved();
        untrack();
        if (runId) {
          await sendActions();
          await finishRun(user.tenantId, runId, { status, error: failure, queueMs, durationMs: Date.now() - t0, outputChars: acc.length, tokensIn: usage?.tokensIn, tokensOut: usage?.tokensOut }).catch((e) => console.error("saving the run failed", e));
        }
        if (status === "done") send({ type: "done" });
        try { controller.close(); } catch { /* already closed */ }
      }
    },
    cancel() { ctl.abort(); },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}
