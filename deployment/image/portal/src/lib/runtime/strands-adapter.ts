import { readSecret, secretInfo } from "../secrets";
import type { ExecutionRequest, RuntimeAdapter, RuntimeCapabilities, RuntimeEvent, RuntimeHealth, RuntimeMessage, WorkerCompile } from "./types";

/**
 * Strands as a Digi runtime (adapter 2). The agent loop runs in a small separate Python service (strands-runtime/) that Digi calls over the private Docker
 * network. Digi sends everything it decided: the instructions, the tools allowed this turn, the history, and the model access. The service builds a Strands
 * agent for that turn, and each tool it calls goes back through Digi's tool gateway with the per-turn handle, exactly as Open WebUI's tool modules do, so
 * Authority, confirm cards, approvals and the audit trail are identical on both runtimes. The service keeps nothing between turns.
 *
 * Model access follows the customer-key decision: the key saved on Settings > AI connection is passed to the service for the turn (server to server only, never
 * logged, never kept). STRANDS_MODEL_* in the environment override it (tests and the pilot).
 */
const url = () => (process.env.STRANDS_RUNTIME_URL || "http://digiworks-strands:8000").replace(/\/$/, "");
const headers = () => ({ "Content-Type": "application/json", "X-Runtime-Key": process.env.STRANDS_RUNTIME_KEY || "" });
const TURN_TIMEOUT_MS = 170_000;

const CAPABILITIES: RuntimeCapabilities = {
  runtime: "strands",
  capabilities: {
    chat: true, streaming: true, tools: true,
    // MCP reaches Strands tools through Digi's own MCP proxy and gateway, not through a Strands MCP client, so a bundle that asks the runtime itself for MCP is not supported yet
    mcp: false,
    conversation_memory: false, persistent_memory: false, agent_handoff: false, graph_workflow: false,
  },
};

type Access = { baseUrl: string; apiKey: string; modelId: string };

async function modelAccess(tenantId: string | undefined, modelId: string): Promise<Access | { error: string }> {
  const envBase = process.env.STRANDS_MODEL_BASE_URL, envKey = process.env.STRANDS_MODEL_API_KEY;
  let key = envKey || (tenantId ? await readSecret(tenantId, "llm_api_key").catch(() => null) : null);
  let baseUrl = envBase;
  if (!baseUrl && tenantId) baseUrl = ((await secretInfo(tenantId, "llm_api_key").catch(() => null))?.meta.baseUrl as string | undefined) || undefined;
  if (!key && envBase) key = "none"; // a local or test endpoint that needs no key
  if (!key) return { error: "No AI key is saved yet. An Admin can add it under Settings > AI connection." };
  return { baseUrl: baseUrl || "https://api.openai.com/v1", apiKey: key, modelId };
}

export class StrandsRuntimeAdapter implements RuntimeAdapter {
  readonly id = "strands" as const;

  capabilities() { return CAPABILITIES; }

  validate(spec: unknown) { return spec && typeof spec === "object" ? { ok: true, problems: [] } : { ok: false, problems: ["spec must be an object"] }; }

  async health(): Promise<RuntimeHealth> {
    try {
      const r = await fetch(`${url()}/health`, { headers: headers(), signal: AbortSignal.timeout(5000), cache: "no-store" });
      if (!r.ok) return { ok: false, detail: `the Strands service answered ${r.status}` };
      const j = (await r.json()) as { strands?: string };
      return { ok: true, detail: `Strands ${j.strands ?? ""} is running`.trim() };
    } catch { return { ok: false, detail: "the Strands service cannot be reached" }; }
  }

  async defaultBaseModel() { return process.env.STRANDS_MODEL_ID || "gpt-4o-mini"; }

  /** There is nothing to build in the runtime: the compiled form is Digi's own definition, kept with the installed Worker. */
  async compileWorker(w: WorkerCompile) { return { modelId: `strands:${w.stack}:${w.workerId}`, definition: { system: w.system } }; }
  async removeWorker() { /* nothing is held by the runtime */ }

  async complete(messages: RuntimeMessage[], tenantId?: string): Promise<string> {
    const a = await modelAccess(tenantId, await this.defaultBaseModel());
    if ("error" in a) throw new Error(a.error);
    const r = await fetch(`${url()}/v1/complete`, { method: "POST", headers: headers(), body: JSON.stringify({ model: a, messages }), signal: AbortSignal.timeout(120_000), cache: "no-store" });
    if (!r.ok) throw new Error(`The AI service could not answer (${r.status}).`);
    return ((await r.json()) as { text?: string }).text ?? "";
  }

  async *startExecution(req: ExecutionRequest): AsyncGenerator<RuntimeEvent> {
    yield { type: "started" };
    if (!req.definition) { yield { type: "failed", message: "This turn has no definition to run." }; return; }
    const access = await modelAccess(req.tenantId, await this.defaultBaseModel());
    if ("error" in access) { yield { type: "failed", message: access.error }; return; }

    const gatewayUrl = (process.env.STRANDS_GATEWAY_URL || "http://digiworks-portal:3000").replace(/\/$/, "");
    let res: Response;
    try {
      res = await fetch(`${url()}/v1/execute`, {
        method: "POST", headers: headers(), cache: "no-store", signal: req.signal ? AbortSignal.any([req.signal, AbortSignal.timeout(TURN_TIMEOUT_MS)]) : AbortSignal.timeout(TURN_TIMEOUT_MS),
        body: JSON.stringify({
          execution_id: req.executionId, system: req.definition.system, messages: req.messages, tools: req.definition.tools,
          model: access, gateway: { url: gatewayUrl, key: process.env.PORTAL_INTERNAL_KEY || "" },
        }),
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      yield { type: "failed", message: "The AI service could not be reached." };
      return;
    }
    if (!res.ok || !res.body) { yield { type: "failed", message: `The AI service could not answer (${res.status}).` }; return; }

    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          let e: { type: string; delta?: string; label?: string; html?: string; tool?: string; message?: string; usage?: { tokensIn?: number; tokensOut?: number } };
          try { e = JSON.parse(line.slice(5).trim()); } catch { continue; }
          if (e.type === "text" && e.delta) yield { type: "text", delta: e.delta };
          else if (e.type === "tool" && e.label) yield { type: "tool", label: e.label };
          else if (e.type === "embed" && e.html) yield { type: "embed", html: e.html, tool: e.tool };
          else if (e.type === "failed") { yield { type: "failed", message: e.message || "The AI service returned an error." }; return; }
          else if (e.type === "completed") { yield { type: "completed", usage: e.usage }; return; }
        }
      }
      yield { type: "failed", message: "The AI service stopped before it finished." };
    } catch (e) {
      if ((e as Error).name !== "AbortError") yield { type: "failed", message: "The connection to the AI service was lost. Please try again." };
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }
}
