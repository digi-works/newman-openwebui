import { randomUUID } from "node:crypto";
import { digiDbEnabled, withTenant } from "./digi-db";
import type { ActionCard } from "./types";

/**
 * Conversations, messages and favorites. The signed-in user owns them: every query is scoped by that user's id
 * (and by tenant through row-level security), and anything that is not theirs behaves as if it does not exist.
 * With no DIGI_DATABASE_URL (demo mode) an in-memory copy is used so the UI still works; it is lost on restart.
 */
export type ChatSummary = { id: string; agentId: string; title: string; updatedAt: number; messageCount: number };
export type ChatMessage = {
  id: string; role: "user" | "assistant"; text: string; status: "streaming" | "done" | "stopped" | "error";
  toolLabel?: string; embeds?: string[]; feedback?: "up" | "down"; actions?: ActionCard[];
};
export type ChatDetail = ChatSummary & { messages: ChatMessage[]; pendingPrompt?: string };
export type Owner = { id: string; tenantId: string };
export type MessagePatch = { content?: string; status?: ChatMessage["status"]; toolLabel?: string | null; embeds?: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** A streaming message nobody has touched for this long belongs to a turn that is gone; show it as stopped. */
const STALE_STREAM_SECONDS = 180;

type Row = Record<string, unknown>;
const summary = (r: Row): ChatSummary => ({
  id: r.id as string, agentId: r.agent_id as string, title: r.title as string,
  updatedAt: new Date(r.updated_at as string).getTime(), messageCount: Number(r.message_count),
});
const message = (r: Row): ChatMessage => ({
  id: r.id as string, role: r.role as "user" | "assistant", text: r.content as string, status: r.status as ChatMessage["status"],
  ...(r.tool_label ? { toolLabel: r.tool_label as string } : {}),
  ...(Array.isArray(r.embeds) && r.embeds.length ? { embeds: r.embeds as string[] } : {}),
  ...(r.feedback ? { feedback: r.feedback as "up" | "down" } : {}),
});

export interface ConversationStore {
  list(u: Owner): Promise<ChatSummary[]>;
  create(u: Owner, input: { agentId: string; pendingPrompt?: string }): Promise<ChatDetail>;
  get(u: Owner, id: string): Promise<ChatDetail | null>;
  remove(u: Owner, id: string): Promise<boolean>;
  patch(u: Owner, id: string, change: { title?: string; clearPending?: boolean }): Promise<boolean>;
  addMessage(u: Owner, conversationId: string, m: { role: "user" | "assistant"; content: string; status: ChatMessage["status"] }): Promise<ChatMessage | null>;
  updateMessage(u: Owner, conversationId: string, messageId: string, patch: MessagePatch): Promise<boolean>;
  setFeedback(u: Owner, conversationId: string, messageId: string, feedback: "up" | "down" | null): Promise<boolean>;
  favorites(u: Owner): Promise<string[]>;
  toggleFavorite(u: Owner, agentId: string): Promise<string[]>;
}

/* ---------------------------------------------------------------- Postgres */
const pgStore: ConversationStore = {
  async list(u) {
    return withTenant(u.tenantId, async (c) => {
      const { rows } = await c.query(
        "select id, agent_id, title, updated_at, message_count from conversations where user_id = $1 and message_count > 0 and status = 'active' order by updated_at desc limit 200",
        [u.id],
      );
      return rows.map(summary);
    });
  },
  async create(u, input) {
    return withTenant(u.tenantId, async (c) => {
      const { rows } = await c.query(
        "insert into conversations (tenant_id, user_id, agent_id, pending_prompt) values ($1, $2, $3, $4) returning id, agent_id, title, updated_at, message_count, pending_prompt",
        [u.tenantId, u.id, input.agentId.slice(0, 200), input.pendingPrompt?.slice(0, 4000) ?? null],
      );
      return { ...summary(rows[0]), messages: [], ...(rows[0].pending_prompt ? { pendingPrompt: rows[0].pending_prompt as string } : {}) };
    });
  },
  async get(u, id) {
    if (!isId(id)) return null;
    return withTenant(u.tenantId, async (c) => {
      const conv = (await c.query("select id, agent_id, title, updated_at, message_count, pending_prompt from conversations where id = $1 and user_id = $2 and status = 'active'", [id, u.id])).rows[0];
      if (!conv) return null;
      await c.query(
        "update messages set status = 'stopped' where conversation_id = $1 and status = 'streaming' and updated_at < now() - make_interval(secs => $2)",
        [id, STALE_STREAM_SECONDS],
      );
      const msgs = (await c.query("select id, role, content, status, tool_label, embeds, feedback from messages where conversation_id = $1 order by seq", [id])).rows;
      return { ...summary(conv), messages: msgs.map(message), ...(conv.pending_prompt ? { pendingPrompt: conv.pending_prompt as string } : {}) };
    });
  },
  async remove(u, id) {
    if (!isId(id)) return false;
    return withTenant(u.tenantId, async (c) => (await c.query("delete from conversations where id = $1 and user_id = $2", [id, u.id])).rowCount === 1);
  },
  async patch(u, id, change) {
    if (!isId(id)) return false;
    return withTenant(u.tenantId, async (c) => {
      const r = await c.query(
        "update conversations set title = coalesce($3, title), pending_prompt = case when $4 then null else pending_prompt end where id = $1 and user_id = $2",
        [id, u.id, change.title?.slice(0, 120) ?? null, change.clearPending === true],
      );
      return r.rowCount === 1;
    });
  },
  async addMessage(u, conversationId, m) {
    if (!isId(conversationId)) return null;
    return withTenant(u.tenantId, async (c) => {
      const own = await c.query("select 1 from conversations where id = $1 and user_id = $2 for update", [conversationId, u.id]);
      if (!own.rows[0]) return null;
      const { rows } = await c.query(
        "insert into messages (tenant_id, conversation_id, user_id, role, content, status) values ($1, $2, $3, $4, $5, $6) returning id, role, content, status, tool_label, embeds, feedback",
        [u.tenantId, conversationId, u.id, m.role, m.content, m.status],
      );
      await c.query("update conversations set message_count = message_count + 1, updated_at = now() where id = $1", [conversationId]);
      return message(rows[0]);
    });
  },
  async updateMessage(u, conversationId, messageId, patch) {
    if (!isId(conversationId) || !isId(messageId)) return false;
    return withTenant(u.tenantId, async (c) => {
      const r = await c.query(
        `update messages set content = coalesce($4, content), status = coalesce($5, status), tool_label = case when $6::boolean then $7 else tool_label end,
                embeds = coalesce($8::jsonb, embeds), updated_at = now()
          where id = $1 and conversation_id = $2 and user_id = $3`,
        [messageId, conversationId, u.id, patch.content ?? null, patch.status ?? null, patch.toolLabel !== undefined, patch.toolLabel ?? null, patch.embeds ? JSON.stringify(patch.embeds) : null],
      );
      if (r.rowCount === 1) await c.query("update conversations set updated_at = now() where id = $1", [conversationId]);
      return r.rowCount === 1;
    });
  },
  async setFeedback(u, conversationId, messageId, feedback) {
    if (!isId(conversationId) || !isId(messageId)) return false;
    return withTenant(u.tenantId, async (c) =>
      (await c.query("update messages set feedback = $4 where id = $1 and conversation_id = $2 and user_id = $3 and role = 'assistant'", [messageId, conversationId, u.id, feedback])).rowCount === 1,
    );
  },
  async favorites(u) {
    return withTenant(u.tenantId, async (c) => (await c.query("select agent_id from user_favorites where user_id = $1 order by created_at", [u.id])).rows.map((r) => r.agent_id as string));
  },
  async toggleFavorite(u, agentId) {
    return withTenant(u.tenantId, async (c) => {
      const del = await c.query("delete from user_favorites where user_id = $1 and agent_id = $2", [u.id, agentId.slice(0, 200)]);
      if (!del.rowCount) await c.query("insert into user_favorites (tenant_id, user_id, agent_id) values ($1, $2, $3)", [u.tenantId, u.id, agentId.slice(0, 200)]);
      return (await c.query("select agent_id from user_favorites where user_id = $1 order by created_at", [u.id])).rows.map((r) => r.agent_id as string);
    });
  },
};

/* ---------------------------------------------------------------- demo mode (memory) */
type MemConv = { id: string; userId: string; agentId: string; title: string; pending?: string; updatedAt: number; messages: ChatMessage[] };
const g = globalThis as { __memConvs?: Map<string, MemConv>; __memFavs?: Map<string, string[]> };
const convs = (): Map<string, MemConv> => (g.__memConvs ??= new Map<string, MemConv>());
const favs = (): Map<string, string[]> => (g.__memFavs ??= new Map<string, string[]>());
const toDetail = (c: MemConv): ChatDetail => ({ id: c.id, agentId: c.agentId, title: c.title, updatedAt: c.updatedAt, messageCount: c.messages.length, messages: c.messages, ...(c.pending ? { pendingPrompt: c.pending } : {}) });
const mine = (u: Owner, id: string) => { const c = convs().get(id); return c && c.userId === u.id ? c : undefined; };

const memStore: ConversationStore = {
  async list(u) { return [...convs().values()].filter((c) => c.userId === u.id && c.messages.length).sort((a, b) => b.updatedAt - a.updatedAt).map((c) => toDetail(c)).map(({ messages: _m, pendingPrompt: _p, ...s }) => { void _m; void _p; return s; }); },
  async create(u, input) { const c: MemConv = { id: randomUUID(), userId: u.id, agentId: input.agentId, title: "New chat", pending: input.pendingPrompt, updatedAt: Date.now(), messages: [] }; convs().set(c.id, c); return toDetail(c); },
  async get(u, id) { const c = mine(u, id); return c ? toDetail(c) : null; },
  async remove(u, id) { return mine(u, id) ? convs().delete(id) : false; },
  async patch(u, id, ch) { const c = mine(u, id); if (!c) return false; if (ch.title) c.title = ch.title; if (ch.clearPending) c.pending = undefined; return true; },
  async addMessage(u, id, m) { const c = mine(u, id); if (!c) return null; const msg: ChatMessage = { id: randomUUID(), role: m.role, text: m.content, status: m.status }; c.messages.push(msg); c.updatedAt = Date.now(); return msg; },
  async updateMessage(u, id, mid, p) { const m = mine(u, id)?.messages.find((x) => x.id === mid); if (!m) return false; if (p.content !== undefined) m.text = p.content; if (p.status) m.status = p.status; if (p.toolLabel !== undefined) m.toolLabel = p.toolLabel ?? undefined; if (p.embeds) m.embeds = p.embeds; return true; },
  async setFeedback(u, id, mid, fb) { const m = mine(u, id)?.messages.find((x) => x.id === mid); if (!m) return false; m.feedback = fb ?? undefined; return true; },
  async favorites(u) { return favs().get(u.id) ?? []; },
  async toggleFavorite(u, agentId) { const cur = favs().get(u.id) ?? []; const next = cur.includes(agentId) ? cur.filter((a) => a !== agentId) : [...cur, agentId]; favs().set(u.id, next); return next; },
};

export const conversationStore = (): ConversationStore => (digiDbEnabled() ? pgStore : memStore);
