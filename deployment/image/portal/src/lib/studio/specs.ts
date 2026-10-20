import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";

/**
 * Canonical, runtime-neutral specs (ST.2). These JSON Schemas are the contract between Studio (which authors them) and any customer stack
 * (which compiles them for its runtime). They contain no runtime class names, no secrets, and no customer data. Every spec carries
 * schema_version so the format can change with an explicit migration.
 *
 * Shared by Studio (to validate what operators write and what the builder generates) and by the customer installer (to validate what it pulls),
 * so both sides apply the very same rules.
 */
export const SCHEMA_VERSION = 1;
export type SpecKind = "tool" | "skill" | "policy" | "model_profile" | "worker";

const id = { type: "string", pattern: "^[a-z0-9][a-z0-9._-]{1,59}$" };
const slug = { type: "string", pattern: "^[a-z0-9][a-z0-9-]{1,40}$" };
const policy = { enum: ["allow", "ask", "deny"] };
const ref = {
  type: "object", additionalProperties: false, required: ["id"],
  properties: { id, version: { type: "integer", minimum: 1 } },
};

export const SCHEMAS: Record<SpecKind, object> = {
  tool: {
    type: "object", additionalProperties: false,
    required: ["schema_version", "id", "title", "description", "risk", "permission", "input_schema", "binding"],
    properties: {
      schema_version: { const: SCHEMA_VERSION },
      id, title: { type: "string", minLength: 1, maxLength: 80 }, description: { type: "string", minLength: 1, maxLength: 400 },
      risk: { enum: ["read", "write", "high_impact"] },
      // the permission a person must hold in the customer's stack for this tool (a tool without one cannot exist)
      permission: { type: "string", pattern: "^[a-z0-9_]+\\.[a-z0-9_]+$" },
      input_schema: { type: "object" },
      binding: {
        oneOf: [
          { type: "object", additionalProperties: false, required: ["kind", "tool"], properties: { kind: { const: "digi_native" }, tool: id } },
          { type: "object", additionalProperties: false, required: ["kind", "server", "tool"], properties: { kind: { const: "mcp" }, server: { type: "string", pattern: "^[a-z0-9][a-z0-9_-]{1,40}$" }, tool: { type: "string", maxLength: 64 } } },
        ],
      },
    },
  },
  skill: {
    type: "object", additionalProperties: false, required: ["schema_version", "id", "title", "content"],
    properties: { schema_version: { const: SCHEMA_VERSION }, id, title: { type: "string", minLength: 1, maxLength: 80 }, content: { type: "string", minLength: 1, maxLength: 4000 } },
  },
  policy: {
    type: "object", additionalProperties: false, required: ["schema_version", "id", "title", "tool_policies"],
    properties: {
      schema_version: { const: SCHEMA_VERSION }, id, title: { type: "string", minLength: 1, maxLength: 80 },
      tool_policies: { type: "object", additionalProperties: policy, propertyNames: id },
      default: policy,
    },
  },
  model_profile: {
    type: "object", additionalProperties: false, required: ["schema_version", "id", "title", "requirements"],
    properties: {
      schema_version: { const: SCHEMA_VERSION }, id, title: { type: "string", minLength: 1, maxLength: 80 },
      requirements: {
        type: "object", additionalProperties: false,
        properties: { tool_calling: { type: "boolean" }, min_context_tokens: { type: "integer", minimum: 1000, maximum: 2_000_000 }, streaming: { type: "boolean" } },
      },
      hints: { type: "object", additionalProperties: false, properties: { reasoning: { enum: ["low", "medium", "high"] }, speed: { enum: ["fast", "balanced", "thorough"] } } },
    },
  },
  worker: {
    type: "object", additionalProperties: false,
    required: ["schema_version", "id", "name", "description", "instructions", "model_profile", "tools"],
    properties: {
      schema_version: { const: SCHEMA_VERSION },
      id: slug,
      // what a customer sees in AI Capabilities: a name and a sentence, never the instructions
      name: { type: "string", minLength: 1, maxLength: 60 },
      description: { type: "string", minLength: 1, maxLength: 240 },
      instructions: { type: "string", minLength: 20, maxLength: 8000 },
      model_profile: ref,
      tools: { type: "array", maxItems: 30, items: { type: "object", additionalProperties: false, required: ["id", "policy"], properties: { id, version: { type: "integer", minimum: 1 }, policy } } },
      skills: { type: "array", maxItems: 10, items: ref },
      policies: { type: "array", maxItems: 10, items: ref },
      routing: {
        type: "object", additionalProperties: false,
        properties: { keywords: { type: "array", maxItems: 40, items: { type: "string", minLength: 2, maxLength: 40 } }, intents: { type: "array", maxItems: 10, items: { type: "string", maxLength: 120 } }, priority: { type: "integer", minimum: 0, maximum: 100 } },
      },
      // the runtime features this Worker needs; a runtime that lacks one rejects the release before activation
      required_runtime_capabilities: { type: "array", items: { enum: ["chat", "streaming", "tools", "mcp", "agent_handoff", "graph_workflow"] }, uniqueItems: true },
      apps: { type: "array", items: { type: "string", pattern: "^[a-z0-9-]{2,30}$" }, uniqueItems: true },
    },
  },
};

const ajv = new Ajv({ allErrors: true, strict: false });
const compiled = new Map<SpecKind, ValidateFunction>();
function validator(kind: SpecKind) {
  let v = compiled.get(kind);
  if (!v) { v = ajv.compile(SCHEMAS[kind]); compiled.set(kind, v); }
  return v;
}

const where = (e: ErrorObject) => (e.instancePath || "/").replace(/^\//, "") || "spec";
const message = (e: ErrorObject) => `${where(e)}: ${e.message ?? "is not valid"}${e.params && "additionalProperty" in e.params ? ` (${String(e.params.additionalProperty)})` : ""}`;

/** Words that betray a runtime. A neutral spec names tools and behaviour, never a runtime's classes or products. */
const RUNTIME_WORDS = /\b(strands|openwebui|open webui|owui|langchain|langgraph|autogen|crewai|llamaindex|pydantic|fastapi|import\s+\w+|from\s+\w+\s+import)\b/i;

function findRuntimeLeaks(v: unknown, path = "", out: string[] = []): string[] {
  if (typeof v === "string") { if (RUNTIME_WORDS.test(v)) out.push(`${path || "spec"} mentions a runtime`); }
  else if (Array.isArray(v)) v.forEach((x, i) => findRuntimeLeaks(x, `${path}[${i}]`, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { if (RUNTIME_WORDS.test(k)) out.push(`${path}.${k} is a runtime name`); findRuntimeLeaks(x, `${path}.${k}`, out); }
  return out;
}

/** Secrets belong in the customer's bindings, never in a spec. */
const SECRET_LIKE = /(sk-[A-Za-z0-9]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.)/;
const findSecrets = (v: unknown): boolean => JSON.stringify(v).match(SECRET_LIKE) !== null;

export type Validation = { ok: true } | { ok: false; problems: string[] };

export function validateSpec(kind: SpecKind, spec: unknown): Validation {
  const v = validator(kind);
  if (!v(spec)) return { ok: false, problems: (v.errors ?? []).map(message) };
  const problems = [...findRuntimeLeaks(spec)];
  if (findSecrets(spec)) problems.push("the spec contains something that looks like a secret");
  return problems.length ? { ok: false, problems } : { ok: true };
}

/** What a bundle must never hold (decision 6.2): keys, credentials, endpoints, customer people or role mappings. */
export function findForbiddenContent(bundle: unknown): string[] {
  const problems: string[] = [];
  const text = JSON.stringify(bundle);
  if (SECRET_LIKE.test(text)) problems.push("a secret or key is present");
  for (const k of ["api_key", "apikey", "password", "token", "secret", "credential", "role_mapping", "endpoint", "database_url", "tenant_id", "user_email"]) {
    if (new RegExp(`"${k}"\\s*:`, "i").test(text)) problems.push(`a field named ${k} is present`);
  }
  return problems;
}
