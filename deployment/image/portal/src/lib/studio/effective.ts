/**
 * Effective tool authority for a Worker: what the Worker's own tool list says, tightened by every Policy it references. The stricter answer
 * always wins (deny over ask over allow). Pure, so Studio can show it at review and the customer stack computes the very same thing when it
 * compiles the Worker. Authority at run time then intersects it with the person's own permissions and the organisation's policy.
 */
export type ToolPolicy = "allow" | "ask" | "deny";
const RANK: Record<ToolPolicy, number> = { allow: 0, ask: 1, deny: 2 };
export const stricter = (a: ToolPolicy, b: ToolPolicy): ToolPolicy => (RANK[a] >= RANK[b] ? a : b);

export type PolicyLike = { tool_policies: Record<string, ToolPolicy>; default?: ToolPolicy };

export function effectiveToolPolicies(
  tools: { id: string; policy: ToolPolicy }[], policies: PolicyLike[],
): Record<string, ToolPolicy> {
  const out: Record<string, ToolPolicy> = {};
  for (const t of tools) {
    let p = t.policy;
    for (const pol of policies) p = stricter(p, pol.tool_policies[t.id] ?? pol.default ?? "allow");
    out[t.id] = p;
  }
  return out;
}
