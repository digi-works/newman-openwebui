/**
 * The runtime-neutral contract between Digi and whatever executes an AI turn (Open WebUI first, Strands later).
 * Nothing outside src/lib/runtime may import a runtime's own client. Adapters translate their native events into the
 * small vocabulary below, and declare what they can do so features degrade or are refused, never silently faked.
 * Architecture v0.4, "RuntimeAdapter". Only the execution part is implemented so far; compile/continue arrive with Studio and M5.
 */
export type CapabilityFlags = {
  chat: boolean;
  streaming: boolean;
  tools: boolean;
  mcp: boolean;
  /** The runtime keeps conversation context itself. False for OWUI: Digi sends the history it chose to send. */
  conversation_memory: boolean;
  /** The runtime keeps durable per-user memory. False for OWUI here: memory is Digi's (v0.3 A5, A7). */
  persistent_memory: boolean;
  agent_handoff: boolean;
  graph_workflow: boolean;
};

export type RuntimeCapabilities = { runtime: string; version?: string; capabilities: CapabilityFlags };

export type RuntimeMessage = { role: "system" | "user" | "assistant"; content: string };

/** A tool as Digi describes it to a runtime that builds its own tool list. The runtime calls the tool gateway with gateway and the per-turn handle. */
export type ToolDefinition = { name: string; gateway: string; description: string; inputSchema: Record<string, unknown> };

export type ExecutionRequest = {
  /** Digi's per-turn handle. Used as the runtime's chat id so tools can recover who is asking (spike S0). */
  executionId: string;
  /** Whose turn it is (for runtimes that need the organisation's own model access). */
  tenantId?: string;
  /** Logical model or agent id the runtime should run. */
  model: string;
  toolIds: string[];
  /**
   * Digi's own definition of what to run, for runtimes that do not hold agents themselves (Strands): the instructions and the tools allowed this turn.
   * Open WebUI ignores it and uses the compiled model and tool modules instead.
   */
  definition?: { system: string; tools: ToolDefinition[] };
  messages: RuntimeMessage[];
  /** Aborting stops the execution and releases its resources. */
  signal?: AbortSignal;
};

export type RuntimeEvent =
  | { type: "started" }
  | { type: "text"; delta: string }
  | { type: "tool"; label: string }
  | { type: "embed"; html: string; tool?: string }
  | { type: "status"; text: string }
  | { type: "completed"; usage?: { tokensIn?: number; tokensOut?: number } }
  | { type: "failed"; message: string };

/** What a runtime needs to turn an installed Worker into something it can run (v0.4 "compile"). */
export type WorkerCompile = {
  stack: string; workerId: string; name: string; description: string;
  /** The Worker's instructions with its Skills and the platform rules already composed. */
  system: string;
  /** The model this stack bound the Worker's Model Profile to (the customer's choice, never in the bundle). */
  baseModel: string;
  /** Tool modules this stack carries the Worker's tools in. */
  toolModules: string[];
};

export type RuntimeHealth = { ok: boolean; detail: string };

export type RuntimeId = "owui" | "strands";

export interface RuntimeAdapter {
  readonly id: RuntimeId;
  capabilities(): RuntimeCapabilities;
  /** Checks a spec against what this runtime supports (used by Studio bundles later). */
  validate(spec: unknown): { ok: boolean; problems: string[] };
  startExecution(req: ExecutionRequest): AsyncGenerator<RuntimeEvent>;
  health(): Promise<RuntimeHealth>;
  /** Makes the runtime able to run this Worker. Idempotent: compiling again updates it in place. */
  compileWorker(w: WorkerCompile): Promise<{ modelId: string; definition?: { system: string } }>;
  /** Removes a compiled Worker (used when a release no longer contains it). */
  removeWorker(modelId: string): Promise<void>;
  /** A single, non-streaming completion (used for small decisions such as choosing between capabilities, and by the Worker builder). */
  complete(messages: RuntimeMessage[], tenantId?: string): Promise<string>;
  /** The model a Model Profile should be bound to on this stack. */
  defaultBaseModel(): Promise<string>;
  // Later milestones: compileWorker(spec, bindings), continueExecution(...), createSession(...), loadContext(...)
}
