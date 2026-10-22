"use client";

import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { campusTime } from "@/lib/campus-time";
import type { Memory } from "@/lib/memory";

/** What Digi remembers about you, in your own words. You can add to it, and delete any note. Digi never adds notes by itself. */
export function MemoryView({ initialItems, enabled }: { initialItems: Memory[]; enabled: boolean }) {
  const [items, setItems] = useState(initialItems);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function add() {
    setBusy("add"); setError("");
    const res = await fetch("/api/memory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }).catch(() => null);
    const out = res ? await res.json().catch(() => ({})) : {};
    setBusy(null);
    if (!res || !res.ok) { setError(out.error ?? "Could not save that."); return; }
    setItems((xs) => (xs.some((x) => x.id === out.item.id) ? xs : [...xs, out.item]));
    setText("");
  }
  async function remove(id: string) {
    setBusy(id);
    const res = await fetch(`/api/memory/${id}`, { method: "DELETE" }).catch(() => null);
    setBusy(null);
    if (res?.ok) setItems((xs) => xs.filter((x) => x.id !== id));
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Memory</h1>
        <p className="text-sm text-muted-foreground">Notes Digi keeps for you, only because you asked. Say “remember that…” in a chat, or add one here. Delete any note at any time.</p>
      </div>
      {!enabled && <p role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">Your organisation has switched memory off. Existing notes are not used, and new ones cannot be added.</p>}
      <section className="space-y-3 rounded-2xl border bg-card p-5">
        <label htmlFor="note" className="text-sm font-medium">Add a note</label>
        <div className="flex gap-2">
          <Input id="note" value={text} maxLength={500} disabled={!enabled} placeholder="For example: I prefer rooms in the Library" onChange={(e) => setText(e.target.value)} />
          <Button disabled={!enabled || !text.trim() || busy !== null} onClick={add}>{busy === "add" && <Loader2 className="animate-spin" />} Save</Button>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </section>
      <section className="rounded-2xl border bg-card">
        <div className="border-b px-5 py-3.5 text-sm font-semibold">Your notes ({items.length})</div>
        {items.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">Digi is not remembering anything for you.</p>
        ) : (
          <ul className="divide-y">
            {items.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                {/* when each note was added, so similar notes can be told apart and old ones found (QA DEF-58) */}
                <div className="min-w-0">
                  <div className="break-words">{m.content}</div>
                  <time dateTime={m.createdAt} className="text-xs text-muted-foreground">Added {campusTime(m.createdAt)}</time>
                </div>
                <Button size="icon-sm" variant="ghost" aria-label="Delete this note" disabled={busy !== null} onClick={() => remove(m.id)}>{busy === m.id ? <Loader2 className="animate-spin" /> : <Trash2 />}</Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
