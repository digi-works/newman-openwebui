"use client";

/**
 * The browser's view of the signed-in person's conversations and favorites. The server owns them (Digi's database), so this is only
 * a cache that keeps the sidebar, History and favorite stars in step: it loads once, updates optimistically, and starts over when a
 * different person signs in. Nothing is stored in the browser.
 */
import { useSyncExternalStore } from "react";
import type { ChatSummary } from "./conversations";

/** failed: the last load of the conversations did not succeed, so an empty list means "unknown", not "none" (QA DEF-52). */
type State = { chats: ChatSummary[]; favorites: string[]; hydrated: boolean; failed: boolean };
const EMPTY: State = { chats: [], favorites: [], hydrated: false, failed: false };

let state: State = EMPTY;
let scope = "";
let started = false;
const listeners = new Set<() => void>();

function set(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

/** People sharing a browser tab never see each other's chats: a new signed-in person resets the cache. Safe to call during render. */
export function setStoreScope(userScope: string) {
  if (userScope === scope) return;
  scope = userScope;
  started = false;
  state = EMPTY;
}

async function load() {
  const mine = scope;
  try {
    const [c, f] = await Promise.all([fetch("/api/conversations"), fetch("/api/favorites")]);
    if (mine !== scope) return; // someone else signed in meanwhile
    // a failed load keeps what was already shown instead of replacing it with nothing
    if (!c.ok) console.error(`Loading conversations failed (HTTP ${c.status})`);
    const chats = c.ok ? ((await c.json()) as { chats: ChatSummary[] }).chats : state.chats;
    const favorites = f.ok ? ((await f.json()) as { favorites: string[] }).favorites : state.favorites;
    set({ chats, favorites, hydrated: true, failed: !c.ok });
  } catch (e) {
    console.error("Loading conversations failed", e);
    if (mine === scope) set({ ...state, hydrated: true, failed: true });
  }
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  if (!started) { started = true; void load(); }
  return () => { listeners.delete(l); };
};

export function useStore() {
  return useSyncExternalStore(subscribe, () => state, () => EMPTY);
}

export const refreshChats = () => load();

/** Starts a conversation on the server and returns its id. */
export async function createChat(agentId: string, pendingPrompt?: string): Promise<string> {
  const res = await fetch("/api/conversations", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentId, prompt: pendingPrompt }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not start a chat.");
  return ((await res.json()) as { id: string }).id;
}

export async function deleteChat(id: string) {
  const before = state;
  set({ ...state, chats: state.chats.filter((c) => c.id !== id) });
  const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" }).catch(() => null);
  if (!res?.ok) set(before);
}

export async function toggleFavorite(agentId: string) {
  const before = state;
  set({ ...state, favorites: state.favorites.includes(agentId) ? state.favorites.filter((f) => f !== agentId) : [...state.favorites, agentId] });
  const res = await fetch("/api/favorites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentId }) }).catch(() => null);
  if (res?.ok) set({ ...state, favorites: ((await res.json()) as { favorites: string[] }).favorites });
  else set(before);
}

/** Conversations that have at least one message, newest first. */
export const visibleChats = (chats: ChatSummary[]) => [...chats].filter((c) => c.messageCount > 0).sort((a, b) => b.updatedAt - a.updatedAt);

export function relativeDay(ts: number): string {
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const day = 86_400_000;
  const diff = startToday.getTime() - ts;
  if (diff <= 0) return "Today";
  if (diff <= day) return "Yesterday";
  if (diff <= 7 * day) return "Earlier this week";
  return "Older";
}

export function timeLabel(ts: number): string {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}
