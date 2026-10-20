"use client";

import { useEffect, useState } from "react";
import { Lightbulb } from "lucide-react";
import type { Fact } from "@/lib/facts";

/** Rotating "Did you know?" line for the top bar. Pauses on hover and focus; click to jump to the next one. */
export function TopbarTicker({ facts }: { facts: Fact[] }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || facts.length < 2) return;
    const t = setInterval(() => setI((n) => (n + 1) % facts.length), 9000);
    return () => clearInterval(t);
  }, [paused, facts.length]);

  if (facts.length === 0) return null;
  const fact = facts[i % facts.length];

  return (
    <button
      type="button"
      onClick={() => setI((n) => (n + 1) % facts.length)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      title="Click for another"
      className="group flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40"
    >
      <Lightbulb className="size-4 shrink-0 text-[oklch(0.5_0.17_22)]" />
      <span className="hidden shrink-0 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground sm:inline">Did you know?</span>
      <span key={fact.id} className="min-w-0 truncate text-sm text-foreground/80 animate-in fade-in duration-500 motion-reduce:animate-none">{fact.text}</span>
    </button>
  );
}
