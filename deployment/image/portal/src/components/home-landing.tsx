"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { ArrowUp, CalendarDays, DoorOpen, Trophy, type LucideIcon } from "lucide-react";
import { TopbarTicker } from "@/components/topbar-ticker";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { createChat } from "@/lib/store";
import type { Fact } from "@/lib/facts";
import type { Agent } from "@/lib/types";
import { cn } from "@/lib/utils";

const ICONS: { icon: LucideIcon; tint: string }[] = [
  { icon: CalendarDays, tint: "bg-brand-tint text-brand" },
  { icon: Trophy, tint: "bg-navy-tint text-primary" },
  { icon: DoorOpen, tint: "bg-success-tint text-success" },
];

const noSubscribe = () => () => {};
// the browser's day and hour as one string, so the snapshot stays equal between renders
const localClock = () => {
  const d = new Date();
  return `${d.toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long" })}|${d.getHours()}`;
};

export function HomeLanding({ hero, firstName, facts }: { hero: Agent | null; firstName: string; facts: Fact[] }) {
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
    <div className="flex min-h-full flex-col px-4 pb-14 pt-12 animate-in fade-in slide-in-from-bottom-2 duration-500 md:px-10 motion-reduce:animate-none">
      <div className="m-auto w-full max-w-[880px]">
        <p className={cn("mb-[26px] flex items-center gap-2.5 text-[11.5px] uppercase tracking-[0.14em] text-muted-foreground", !clock && "invisible")}>
          <span className="size-1.5 rounded-full bg-brand" />
          {today}
        </p>
        <h1 className={cn("text-[44px] leading-[1.04] tracking-[-0.02em] text-primary sm:text-[64px]", !clock && "invisible")}>
          {greeting}{firstName ? `, ${firstName}` : ""}.
        </h1>
        <p className="mt-[18px] max-w-[560px] text-[19px] leading-normal text-muted-foreground">
          Ask Digi about campus events, game days and rooms. It brings in the right worker when you need one.
        </p>

        <form
          onSubmit={(e) => { e.preventDefault(); ask(text); setText(""); }}
          className="mt-10 rounded-[18px] border bg-card px-5 pb-3.5 pt-[18px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-18px_rgba(7,29,73,0.22)] dark:shadow-none"
        >
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(text); setText(""); } }}
            rows={2}
            disabled={!hero}
            placeholder={hero ? `Ask ${hero.name}…` : "Digi isn’t available to your account yet."}
            aria-label="Ask Digi"
            className="min-h-14 resize-none border-0 bg-transparent px-0.5 pb-3.5 text-[17px] shadow-none focus-visible:ring-0 md:text-[17px] dark:bg-transparent"
          />
          <div className="flex items-center justify-end">
            <Button
              type="submit"
              size="icon"
              aria-label="Send"
              disabled={!text.trim() || !hero}
              className="size-[38px] rounded-[10px] hover:bg-brand disabled:bg-[#d6d9de] disabled:text-white disabled:opacity-100 dark:disabled:bg-[#3a3a3a]"
            >
              <ArrowUp />
            </Button>
          </div>
        </form>

        {pinned.length > 0 && (
          <div className="mt-[26px] grid gap-3.5 sm:grid-cols-3">
            {pinned.map((p, i) => {
              const { icon: Icon, tint } = ICONS[i % ICONS.length];
              return (
                <button
                  key={p.title}
                  onClick={() => ask(p.prompt)}
                  className="flex min-h-[168px] flex-col items-start gap-2.5 rounded-[14px] border bg-card p-[18px] text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-all duration-150 hover:-translate-y-0.5 hover:border-[#c9c6c2] hover:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_14px_30px_-20px_rgba(7,29,73,0.35)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 dark:hover:border-[#454545]"
                >
                  <span className={cn("flex size-[34px] items-center justify-center rounded-[9px]", tint)}><Icon className="size-4" /></span>
                  <span className="text-[15px] font-semibold tracking-[-0.01em]">{p.title}</span>
                  {p.description && <span className="text-[13.5px] leading-normal text-muted-foreground">{p.description}</span>}
                </button>
              );
            })}
          </div>
        )}

        {facts.length > 0 && <div className="mt-8 border-t pt-4"><TopbarTicker facts={facts} /></div>}
      </div>
    </div>
  );
}
