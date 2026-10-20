"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, MessageSquare, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AgentAvatar } from "@/components/agent-avatar";
import { FavoriteButton } from "@/components/favorite-button";
import { SegmentedTabs } from "@/components/segmented-tabs";
import { useStore } from "@/lib/store";
import { hueOf } from "@/lib/hue";
import type { Agent } from "@/lib/types";

export function WorkersGallery({ agents }: { agents: Agent[] }) {
  const { favorites } = useStore();
  const [tab, setTab] = useState("All");
  const [q, setQ] = useState("");

  const tabs = useMemo(() => {
    const cats = Array.from(new Set(agents.map((a) => a.category)));
    return [
      { value: "All", label: "All", count: agents.length },
      { value: "Favorites", label: "Favorites", count: agents.filter((a) => favorites.includes(a.id)).length },
      ...cats.map((c) => ({ value: c, label: c, count: agents.filter((a) => a.category === c).length })),
    ];
  }, [agents, favorites]);

  const list = agents.filter((a) => {
    if (tab === "Favorites" && !favorites.includes(a.id)) return false;
    if (tab !== "All" && tab !== "Favorites" && a.category !== tab) return false;
    const hay = `${a.name} ${a.description} ${a.category} ${a.capabilities.join(" ")}`.toLowerCase();
    return !q.trim() || hay.includes(q.trim().toLowerCase());
  });

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div>
        <h1 className="text-4xl font-semibold tracking-tight text-primary md:text-5xl">Workers</h1>
        <p className="mt-1 text-muted-foreground">Specialists you can talk to directly. Pick one to start a conversation.</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedTabs label="Filter workers" items={tabs} value={tab} onChange={setTab} className="sm:max-w-[calc(100%-19rem)]" />
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search workers" aria-label="Search workers" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {list.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          {agents.length === 0 ? "No workers have been shared with your account yet. Ask your administrator for access." : tab === "Favorites" && !q ? "Star a worker to pin it here." : `No workers match “${q || tab}”. Try another word or category.`}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((a) => (
            <Card key={a.id} className="relative transition-colors hover:bg-muted/50">
              <CardHeader>
                <div className="flex items-center gap-3 pr-8">
                  <AgentAvatar name={a.name} />
                  <div className="min-w-0 space-y-1">
                    <CardTitle>
                      <Link href={`/workers/${encodeURIComponent(a.id)}`} className="after:absolute after:inset-0 after:content-['']">{a.name}</Link>
                    </CardTitle>
                    <Badge variant="outline" className="hue-tint" style={{ "--h": hueOf(a.category) } as React.CSSProperties}>{a.category}</Badge>
                  </div>
                </div>
                <div className="absolute right-3 top-3 z-10"><FavoriteButton agentId={a.id} /></div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col justify-between gap-4">
                <CardDescription>{a.description}</CardDescription>
                <div className="flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground"><span className="size-1.5 rounded-full bg-emerald-500" />Online</span>
                  <span className="inline-flex items-center gap-1 font-medium"><MessageSquare className="size-3.5" />Chat <ArrowRight className="size-3.5" /></span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
