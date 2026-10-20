import { hasPermission, type PermissionCode } from "./permissions";

/**
 * The Authority engine (architecture v0.4, M5.7). It is the only place that decides whether a tool may run. Prompt text is advisory;
 * this is authoritative.
 *
 *   effective permission = the actor's grants  ∩  the Worker's policy  ∩  the tool's policy
 *
 * An actor is a signed-in person or a named service identity (automations) with explicit grants. The result is ALLOW (run it),
 * ASK (another person must approve first: the job engine pauses it) or DENY (never run it, never invoke it). Separate from this is
 * the confirm-in-UI step for writes (M5.4): that is the actor confirming their own action, while ASK means someone else decides.
 *
 * Pure and synchronous on purpose, so it is easy to test and cannot reach the database or the network.
 */
export type Policy = "allow" | "ask" | "deny";

export type AuthorityActor =
  | { kind: "user"; id: string; permissions: readonly string[] }
  | { kind: "service"; id: string; name: string; permissions: readonly string[] };

export type ToolRule = {
  name: string;
  /** The permission that guards the tool. A tool without one cannot be registered. */
  permission: string;
  risk: "read" | "write" | "high_impact";
  /** What the platform default says, before the tenant overrides it. */
  policy: Policy;
  /** The tenant switched this capability off. */
  enabled: boolean;
};

/** What a Worker (or a subworker) is allowed to call. null means the Worker adds no limit of its own. */
export type WorkerPolicy = { name: string; allow: readonly string[] | null; /** tools this Worker may use only with another person's approval */ ask?: readonly string[]; parent?: WorkerPolicy };

export type Decision = { decision: "ALLOW" | "ASK" | "DENY"; reason: string };

const deny = (reason: string): Decision => ({ decision: "DENY", reason });

/** A subworker can only ever do what every worker above it allows. */
function workerAsks(w: WorkerPolicy | undefined, tool: string): boolean {
  for (let cur = w; cur; cur = cur.parent) if (cur.ask?.includes(tool)) return true;
  return false;
}

function workerAllows(w: WorkerPolicy | undefined, tool: string): string | null {
  for (let cur = w; cur; cur = cur.parent) {
    if (cur.allow && !cur.allow.includes(tool)) return `the ${cur.name} worker is not allowed to use this tool`;
  }
  return null;
}

/** approved: another person has already decided yes for this exact action (an approval record). It turns ASK into ALLOW and never overrides DENY. */
export function authorize(actor: AuthorityActor, tool: ToolRule, worker?: WorkerPolicy, opts: { approved?: boolean } = {}): Decision {
  if (!tool.permission) return deny("the tool has no permission");
  if (!tool.enabled) return deny("this capability is turned off for your organisation");
  if (tool.policy === "deny") return deny("the organisation's policy does not allow this tool");
  if (!hasPermission(actor.permissions, tool.permission as PermissionCode)) return deny("your role does not include this permission");
  const blocked = workerAllows(worker, tool.name);
  if (blocked) return deny(blocked);
  if (tool.policy === "ask" || tool.risk === "high_impact" || workerAsks(worker, tool.name)) {
    return opts.approved ? { decision: "ALLOW", reason: "approved by another person" } : { decision: "ASK", reason: "another person must approve this first" };
  }
  return { decision: "ALLOW", reason: "allowed" };
}
