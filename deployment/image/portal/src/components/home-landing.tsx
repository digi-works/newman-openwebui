"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { ArrowUp, CalendarDays, DoorOpen, Trophy, type LucideIcon } from "lucide-react";
import { AgentAvatar } from "@/components/agent-avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { createChat } from "@/lib/store";
import type { Agent } from "@/lib/types";
import { cn } from "@/lib/utils";

const ICONS: { icon: LucideIcon; tint: string }[] = [
  { icon: CalendarDays, tint: "bg-[oklch(0.94_0.04_22)] text-[oklch(0.45_0.15_22)] dark:bg-[oklch(0.32_0.08_22)] dark:text-[oklch(0.88_0.08_22)]" },
  { icon: Trophy, tint: "bg-[oklch(0.94_0.03_265)] text-[oklch(0.35_0.1_265)] dark:bg-[oklch(0.32_0.07_265)] dark:text-[oklch(0.88_0.07_250)]" },
  { icon: DoorOpen, tint: "bg-[oklch(0.94_0.04_160)] text-[oklch(0.4_0.1_160)] dark:bg-[oklch(0.32_0.07_160)] dark:text-[oklch(0.88_0.08_160)]" },
];

function Hl({ children }: { children: React.ReactNode }) {
  return <span className="font-bold text-[oklch(0.5_0.17_22)] dark:text-[oklch(0.78_0.12_22)]">{children}</span>;
}

const noSubscribe = () => () => {};
// the browser's day and hour as one string, so the snapshot stays equal between renders
const localClock = () => {
  const d = new Date();
  return `${d.toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long" })}|${d.getHours()}`;
};

export function HomeLanding({ hero, firstName }: { hero: Agent | null; firstName: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  // The viewer's own clock, read only in the browser: the server (UTC) never renders a day or greeting
  // that would then change on load (QA DEF-19); they stay hidden until the browser fills them in.
  const clock = useSyncExternalStore(noSubscribe, localClock, () => null);
  const [today, hour] = clock ? clock.split("|") : ["\u00a0", "0"];
  const greeting = Number(hour) < 12 ? "Good morning" : Number(hour) < 18 ? "Good afternoon" : "Good evening";

  async function ask(prompt: string) {
    const p = prompt.trim();
    if (!p || !hero) return;
    router.push(`/chat/${await createChat(hero.id, p)}`);
  }

  const pinned = hero?.pinned?.length
    ? hero.pinned.slice(0, 3)
    : (hero?.starters ?? []).slice(0, 3).map((s) => ({ title: s, description: "", prompt: s }));

  return (
    <div className="relative isolate flex min-h-full flex-col justify-center overflow-hidden px-4 py-10 md:px-8">
      {/* Digi "behind" the box: soft Newman navy and red light */}
      <div aria-hidden className="hero-glow pointer-events-none absolute inset-x-0 top-0 -z-10 h-80" />
      {hero && (
        <div aria-hidden className="pointer-events-none absolute -right-24 bottom-[-6rem] -z-10 select-none text-[22rem] font-semibold leading-none tracking-tighter text-primary/[0.04]">
          {hero.name.charAt(0)}
        </div>
      )}

      <div className="mx-auto w-full max-w-3xl space-y-8">
        <div className="space-y-4">
          <p className={cn("flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground", !clock && "invisible")}>
            <span className="size-1.5 rounded-full bg-[oklch(0.5_0.17_22)]" />
            {today}
          </p>
          <h1 className={cn("text-5xl font-semibold leading-[1.05] tracking-tight text-primary sm:text-6xl", !clock && "invisible")}>
            {greeting}{firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground">
            Ask <strong className="font-semibold text-foreground">Digi</strong>, your <Hl>D</Hl>igital <Hl>I</Hl>nstitutional <Hl>G</Hl>ateway for <Hl>I</Hl>nformation, about events, game days and rooms. It brings in the right worker when you need one.
          </p>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); ask(text); setText(""); }}
          className="rounded-3xl border bg-card p-4 shadow-[0_8px_30px_-12px_rgba(17,32,75,0.25)] transition-shadow focus-within:shadow-[0_8px_30px_-8px_rgba(17,32,75,0.35)] focus-within:ring-3 focus-within:ring-ring/25"
        >
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(text); setText(""); } }}
            rows={2}
            disabled={!hero}
            placeholder={hero ? `Ask ${hero.name}…` : "Digi isn’t available to your account yet."}
            aria-label="Ask Digi"
            className="min-h-14 resize-none border-0 bg-transparent px-1 text-base shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <div className="mt-2 flex items-center justify-between">
            {hero ? (
              <span className="inline-flex items-center gap-2 rounded-full bg-muted py-1 pl-1 pr-3 text-sm font-medium">
                <AgentAvatar name={hero.name} className="size-6 text-xs" />
                {hero.name}
                <span className="size-1.5 rounded-full bg-emerald-500" aria-label="Online" />
              </span>
            ) : <span />}
            <Button type="submit" size="icon-lg" className="rounded-xl" aria-label="Send" disabled={!text.trim() || !hero}><ArrowUp /></Button>
          </div>
        </form>

        {pinned.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-3">
            {pinned.map((p, i) => {
              const { icon: Icon, tint } = ICONS[i % ICONS.length];
              return (
                <button
                  key={p.title}
                  onClick={() => ask(p.prompt)}
                  className="group flex flex-col gap-3 rounded-2xl border bg-card p-5 text-left shadow-xs transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                >
                  <span className={cn("flex size-10 items-center justify-center rounded-xl", tint)}><Icon className="size-5" /></span>
                  <span className="space-y-1">
                    <span className="block font-semibold">{p.title}</span>
                    {p.description && <span className="block text-sm leading-snug text-muted-foreground">{p.description}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
