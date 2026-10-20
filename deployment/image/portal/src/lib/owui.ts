/**
 * Server-only Open WebUI client. Users sign in with their Open WebUI account; the portal keeps their
 * token in an httpOnly cookie and calls Open WebUI as that user, so Open WebUI's own access rules apply.
 *
 * Env:
 *   OWUI_BASE_URL    e.g. http://openwebui:8080 (reachable from the portal container). Unset = mock mode.
 *   OWUI_AGENT_TAG   optional: only models carrying this tag are shown as agents
 */
import type { Agent } from "./types";

export const owuiBase = () => (process.env.OWUI_BASE_URL || "").replace(/\/$/, "");

export const isLive = () => Boolean(owuiBase());

export function owuiFetch(path: string, init: RequestInit = {}, token: string) {
  return fetch(`${owuiBase()}${path}`, {
    ...init,
    cache: "no-store",
    headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
  });
}

type OwuiModel = {
  id: string;
  name?: string;
  owned_by?: string;
  tags?: { name: string }[];
  info?: {
    is_active?: boolean;
    base_model_id?: string | null;
    updated_at?: number;
    meta?: {
      description?: string | null;
      tags?: { name: string }[];
      suggestion_prompts?: { content?: string; title?: string[] | string | null }[] | null;
      knowledge?: { name?: string }[];
      toolIds?: string[];
    };
  } | null;
};

const fmtDate = (sec?: number) =>
  sec ? new Date(sec * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";

function toAgent(m: OwuiModel, toolName: (id: string) => string): Agent {
  const meta = m.info?.meta ?? {};
  const tags = [...(m.tags ?? []), ...(meta.tags ?? [])].map((t) => t.name).filter(Boolean);
  const description = meta.description?.trim() || "";
  return {
    id: m.id,
    name: m.name || m.id,
    category: tags.find((t) => t.toLowerCase() !== (process.env.OWUI_AGENT_TAG || "").toLowerCase()) || "General",
    description: description || "Ask this worker anything within its area.",
    longDescription: description,
    capabilities: [],
    tools: [
      ...(meta.knowledge ?? []).map((k) => ({ name: k.name || "Knowledge base", status: "Knowledge" })),
      ...(meta.toolIds ?? []).map((t) => ({ name: toolName(t), status: "Tool" })),
    ],
    toolIds: meta.toolIds ?? [],
    starters: (meta.suggestion_prompts ?? []).map((p) => p.content?.trim() || "").filter(Boolean),
    pinned: (meta.suggestion_prompts ?? [])
      .map((p) => {
        const t = Array.isArray(p.title) ? p.title : p.title ? [p.title] : [];
        return { title: (t[0] || "").trim(), description: (t[1] || "").trim(), prompt: (p.content || "").trim() };
      })
      .filter((p) => p.prompt && p.title),
    owner: "",
    version: "",
    updated: fmtDate(m.info?.updated_at),
    rating: null,
    access: "",
    limits: "",
  };
}

// Short-lived per-user cache: what a user may see depends on their own access.
const cache = new Map<string, { at: number; agents: Agent[] }>();

export async function listOwuiAgents(token: string): Promise<Agent[]> {
  const hit = cache.get(token);
  if (hit && Date.now() - hit.at < 15_000) return hit.agents;
  const res = await owuiFetch("/api/models", {}, token);
  if (!res.ok) throw new Error(`Open WebUI returned ${res.status} for /api/models`);
  const models: OwuiModel[] = ((await res.json()).data ?? []).filter((m: OwuiModel) => m.id !== "arena-model" && m.owned_by !== "arena");

  const tag = (process.env.OWUI_AGENT_TAG || "").toLowerCase();
  // Workers are custom models built on a base model. A base model that is merely shared (no base_model_id) is not a worker.
  let picked = models.filter((m) => m.info?.base_model_id && m.info.is_active !== false);
  // A Worker compiled from an installed release is a capability, not something people browse: it never appears on the Workers page.
  picked = picked.filter((m) => ![...(m.tags ?? []), ...(m.info?.meta?.tags ?? [])].some((t) => t.name.startsWith("stack:")));
  if (tag) picked = picked.filter((m) => [...(m.tags ?? []), ...(m.info?.meta?.tags ?? [])].some((t) => t.name.toLowerCase() === tag));

  // Friendly tool names (the ids are internal). Falls back to the id if the list is not available.
  const toolNames = new Map<string, string>();
  try {
    const tr = await owuiFetch("/api/v1/tools/", {}, token);
    if (tr.ok) for (const t of (await tr.json()) as { id: string; name?: string }[]) if (t.name) toolNames.set(t.id, t.name);
  } catch {}
  const toolName = (id: string) => toolNames.get(id) ?? id.replace(/^server:mcp:/, "");
  const agents = picked.map((m) => toAgent(m, toolName)).sort((a, b) => a.name.localeCompare(b.name));
  if (cache.size > 200) cache.clear();
  cache.set(token, { at: Date.now(), agents });
  return agents;
}
