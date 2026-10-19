"use client";

import Link from "next/link";
import { useState } from "react";
import { Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentAvatar } from "@/components/agent-avatar";
import { deleteChat, relativeDay, timeLabel, useStore, visibleChats } from "@/lib/store";
import type { Agent } from "@/lib/types";

const ORDER = ["Today", "Yesterday", "Earlier this week", "Older"];

export function HistoryList({ agents }: { agents: Agent[] }) {
  const { chats, hydrated } = useStore();
  const [q, setQ] = useState("");
  // Deleting asks first (QA DEF-29): the trash button turns the row into "Delete this chat?", and only "Yes, delete" deletes.
  const [confirming, setConfirming] = useState<string | null>(null);
  const name = (id: string) => agents.find((a) => a.id === id)?.name ?? "Agent";

  const groups = new Map<string, ReturnType<typeof visibleChats>>();
  visibleChats(chats)
    .filter((c) => !q.trim() || `${c.title} ${name(c.agentId)}`.toLowerCase().includes(q.trim().toLowerCase()))
    .forEach((c) => { const g = relativeDay(c.updatedAt); groups.set(g, [...(groups.get(g) ?? []), c]); });

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">History</h1>
          <p className="text-muted-foreground">Your past conversations with agents.</p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search conversations" aria-label="Search conversations" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {!hydrated ? (
        <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
      ) : groups.size === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          {q ? `No conversations match “${q}”.` : "No conversations yet. Pick a worker to start one."}
        </div>
      ) : (
        ORDER.filter((g) => groups.has(g)).map((g) => (
          <section key={g} className="space-y-2">
            <h2 className="text-xs font-medium text-muted-foreground">{g}</h2>
            {groups.get(g)!.map((c) => (
              <div key={c.id} className="group relative flex items-center gap-3 rounded-xl border bg-card p-3 shadow-xs transition-colors hover:bg-muted/50">
                <AgentAvatar name={name(c.agentId)} className="size-8" />
                <div className="min-w-0 flex-1">
                  <Link href={`/chat/${c.id}`} className="block truncate text-sm font-medium after:absolute after:inset-0 after:content-['']">{c.title}</Link>
                  <div className="truncate text-xs text-muted-foreground">{name(c.agentId)}</div>
                </div>
                {confirming === c.id ? (
                  <div className="relative z-10 flex items-center gap-2">
                    <span className="hidden text-xs text-muted-foreground sm:inline">Delete this chat? This cannot be undone.</span>
                    <Button size="sm" variant="destructive" aria-label={`Yes, delete ${c.title}`} onClick={() => { setConfirming(null); deleteChat(c.id); }}>Yes, delete</Button>
                    <Button size="sm" variant="outline" autoFocus onClick={() => setConfirming(null)}>Keep it</Button>
                  </div>
                ) : (
                  <>
                    <time className="text-xs text-muted-foreground">{timeLabel(c.updatedAt)}</time>
                    <Button variant="ghost" size="icon-sm" className="relative z-10 opacity-0 focus-visible:opacity-100 group-hover:opacity-100" aria-label={`Delete ${c.title}`} onClick={() => setConfirming(c.id)}>
                      <Trash2 />
                    </Button>
                  </>
                )}
              </div>
            ))}
          </section>
        ))
      )}
    </div>
  );
}
