import { owuiBase } from "../owui";
import { acquireAccount, pool, type OwuiEvent } from "./owui-connections";
import { runtimeToken } from "../owui-runtime";
import type { ExecutionRequest, RuntimeAdapter, RuntimeMessage, RuntimeCapabilities, RuntimeEvent, RuntimeHealth, WorkerCompile } from "./types";

/**
 * Open WebUI as a Digi runtime (adapter 1). Digi sends the model, the tool list and the history it chose; Open WebUI runs the
 * model and the tool-call loop. Tool results and forms only arrive over its websocket (plain HTTP streaming stops at the first
 * tool call), so this adapter uses the pooled, multiplexed sockets in owui-connections.ts, and falls back to plain text streaming
 * only if no socket can be opened. Pin the Open WebUI version and run the contract tests when upgrading it.
 */
const TURN_TIMEOUT_MS = 150_000;

const CAPABILITIES: RuntimeCapabilities = {
  runtime: "owui",
  capabilities: {
    chat: true, streaming: true, tools: true, mcp: true,
    conversation_memory: false, persistent_memory: false, agent_handoff: false, graph_workflow: false,
  },
};

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj | undefined => (v && typeof v === "object" ? (v as Obj) : undefined);
const toolLabel = (name: string) => `Used ${name.replace(/_/g, " ")}`;

export class OwuiRuntimeAdapter implements RuntimeAdapter {
  readonly id = "owui" as const;

  capabilities() { return CAPABILITIES; }

  validate(spec: unknown) {
    // Studio bundles arrive later; until then OWUI accepts only what the portal itself sends.
    return asObj(spec) ? { ok: true, problems: [] } : { ok: false, problems: ["spec must be an object"] };
  }

  async health(): Promise<RuntimeHealth> {
    const accounts = pool();
    if (!accounts.length) return { ok: false, detail: "no runtime accounts configured" };
    // The sockets connect on first use, so right after a restart none is up yet: try to connect one before reporting.
    if (!accounts.some((a) => a.up)) await acquireAccount().catch(() => undefined);
    const up = accounts.filter((a) => a.up).length;
    return { ok: up > 0, detail: `${up} of ${accounts.length} runtime accounts connected` };
  }

  /* ---- compile: an installed Worker becomes an Open WebUI model (a base model, a system prompt and a list of tool modules) */
  private admin() {
    const token = process.env.OWUI_API_KEY || "";
    if (!token) throw new Error("The AI service admin access is not configured on this server.");
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  }

  async defaultBaseModel(): Promise<string> {
    if (process.env.OWUI_BASE_MODEL) return process.env.OWUI_BASE_MODEL;
    const r = await fetch(`${owuiBase()}/api/v1/models/model?id=digi`, { headers: this.admin(), cache: "no-store" }).catch(() => null);
    const j = r?.ok ? ((await r.json().catch(() => null)) as { base_model_id?: string } | null) : null;
    return j?.base_model_id || "gpt-4o-mini";
  }

  async complete(messages: RuntimeMessage[]): Promise<string> { // tenant not needed: Open WebUI holds the key
    const res = await fetch(`${owuiBase()}/api/chat/completions`, {
      method: "POST", headers: { Authorization: `Bearer ${await runtimeToken()}`, "Content-Type": "application/json" }, cache: "no-store", signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({ model: await this.defaultBaseModel(), stream: false, messages }),
    });
    if (!res.ok) throw new Error(`The AI service could not answer (${res.status}).`);
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return j.choices?.[0]?.message?.content ?? "";
  }

  async compileWorker(w: WorkerCompile): Promise<{ modelId: string }> {
    const id = `w-${w.stack}-${w.workerId}`;
    const body = {
      id, base_model_id: w.baseModel, name: w.name, params: { system: w.system },
      // the stack tag keeps a compiled Worker out of every other stack's lists, and out of the Workers page
      meta: { description: w.description, tags: [{ name: `stack:${w.stack}` }], toolIds: w.toolModules, capabilities: {} },
      access_grants: [{ principal_type: "user", principal_id: "*", permission: "read" }], is_active: true,
    };
    const first = await fetch(`${owuiBase()}/api/v1/models/create`, { method: "POST", headers: this.admin(), body: JSON.stringify(body), cache: "no-store" });
    const created = first.ok && (await first.json().catch(() => null));
    if (!created) {
      const res = await fetch(`${owuiBase()}/api/v1/models/model/update`, { method: "POST", headers: this.admin(), body: JSON.stringify(body), cache: "no-store" });
      if (!res.ok) throw new Error(`The AI service would not accept the Worker (${res.status}).`);
    }
    // Open WebUI keeps a short-lived list of models, so a Worker is only ready once that list shows it. Reading the list also refreshes it.
    for (let i = 0; i < 20; i++) {
      const list = await fetch(`${owuiBase()}/api/models`, { headers: this.admin(), cache: "no-store" }).catch(() => null);
      const data = list?.ok ? ((await list.json().catch(() => null)) as { data?: { id: string }[] } | null) : null;
      if (data?.data?.some((m) => m.id === id)) return { modelId: id };
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("The compiled Worker did not become available in the AI service.");
  }

  async removeWorker(modelId: string): Promise<void> {
    await fetch(`${owuiBase()}/api/v1/models/model/delete`, { method: "POST", headers: this.admin(), body: JSON.stringify({ id: modelId }), cache: "no-store" }).catch(() => undefined);
  }

  async *startExecution(req: ExecutionRequest): AsyncGenerator<RuntimeEvent> {
    yield { type: "started" };
    let account;
    try {
      account = await acquireAccount();
    } catch {
      yield* this.plainStream(req);
      return;
    }

    const queue: RuntimeEvent[] = [];
    let wake: (() => void) | null = null;
    let finished = false;
    const push = (e: RuntimeEvent) => { queue.push(e); wake?.(); };
    const calls = new Map<string, string>();
    // A Stop or a closed tab must end the turn at once, even while we are waiting for the next event.
    let aborted = false;
    const onAbort = () => { aborted = true; wake?.(); };
    req.signal?.addEventListener("abort", onAbort, { once: true });
    if (req.signal?.aborted) aborted = true;

    account.inflight++;
    account.listeners.set(req.executionId, (e: OwuiEvent) => {
      if (e.__disconnect) { push({ type: "failed", message: "The connection to the AI service was lost. Please try again." }); return; }
      const t = e.data?.type, p = e.data?.data;
      if (!p) return;
      if (t === "response:completion") {
        if (p.type === "response.output_text.delta" && typeof p.delta === "string" && p.delta) push({ type: "text", delta: p.delta });
        else if (p.type === "response.output_item.added") {
          const item = asObj(p.item);
          const name = (item?.name as string) || (item?.server_label as string);
          if ((item?.type === "function_call" || item?.type === "mcp_call") && name) push({ type: "tool", label: toolLabel(name) });
        }
      } else if (t === "status" && typeof p.description === "string" && !p.done) {
        push({ type: "status", text: p.description });
      } else if (t === "chat:completion") {
        if (p.error) {
          const err = asObj(p.error);
          push({ type: "failed", message: typeof p.error === "string" ? p.error : (err?.content as string) || "The AI service returned an error." });
        }
        if (p.done) {
          for (const o of (Array.isArray(p.output) ? p.output : []) as Obj[]) {
            if (o.type === "function_call" && typeof o.call_id === "string" && typeof o.name === "string") calls.set(o.call_id, o.name);
            if (o.type === "function_call_output" && Array.isArray(o.embeds)) {
              for (const html of o.embeds) if (typeof html === "string") push({ type: "embed", html, tool: calls.get(o.call_id as string) });
            }
          }
          const u = asObj(p.usage);
          const num = (v: unknown) => (typeof v === "number" ? v : undefined);
          push({ type: "completed", usage: u ? { tokensIn: num(u.prompt_tokens) ?? num(u.input_tokens), tokensOut: num(u.completion_tokens) ?? num(u.output_tokens) } : undefined });
        }
      }
    });
    const timer = setTimeout(() => push({ type: "failed", message: "The AI service took too long to answer." }), TURN_TIMEOUT_MS);
    let taskIds: string[] = [];

    try {
      const res = await fetch(`${owuiBase()}/api/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${account.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: req.model, stream: true, tool_ids: req.toolIds, chat_id: req.executionId,
          id: crypto.randomUUID(), session_id: account.socket?.id, messages: req.messages,
        }),
        signal: req.signal,
        cache: "no-store",
      });
      if (!res.ok) {
        console.error("runtime refused a turn", res.status, (await res.text().catch(() => "")).slice(0, 300));
        if (res.status === 401 || res.status === 403) account.reset();
        yield { type: "failed", message: `The AI service could not answer (${res.status}).` };
        return;
      }
      taskIds = ((await res.json().catch(() => ({}))) as { task_ids?: string[] }).task_ids ?? [];

      for (;;) {
        if (!queue.length && !aborted) await new Promise<void>((r) => { wake = r; });
        wake = null;
        if (aborted) return;
        while (queue.length) {
          const e = queue.shift()!;
          yield e;
          if (e.type === "completed" || e.type === "failed") { finished = true; return; }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") yield { type: "failed", message: "Could not reach the AI service." };
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener("abort", onAbort);
      account.listeners.delete(req.executionId);
      account.inflight--;
      if (!finished && taskIds.length && account.token) {
        for (const id of taskIds) void fetch(`${owuiBase()}/api/tasks/stop/${id}`, { method: "POST", headers: { Authorization: `Bearer ${account.token}` } }).catch(() => undefined);
      }
    }
  }

  /** Text-only fallback when no websocket can be opened. Tools and forms do not work on this path. */
  private async *plainStream(req: ExecutionRequest): AsyncGenerator<RuntimeEvent> {
    const account = pool()[0];
    if (!account) { yield { type: "failed", message: "The AI service is not configured." }; return; }
    try {
      const token = account.token ?? (await account.signIn());
      const res = await fetch(`${owuiBase()}/api/chat/completions`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: req.model, messages: req.messages, stream: true }), signal: req.signal, cache: "no-store",
      });
      if (!res.ok || !res.body) { yield { type: "failed", message: `The AI service could not answer (${res.status}).` }; return; }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
            const d = j.choices?.[0]?.delta?.content;
            if (d) yield { type: "text", delta: d };
          } catch { /* ignore partial frames */ }
        }
      }
      yield { type: "completed" };
    } catch (e) {
      if ((e as Error).name !== "AbortError") yield { type: "failed", message: "Could not reach the AI service." };
    }
  }
}
