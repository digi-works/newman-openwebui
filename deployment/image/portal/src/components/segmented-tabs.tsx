"use client";

import { cn } from "@/lib/utils";

export type SegmentItem = { value: string; label: string; count?: number };

/** Pill-style segmented control: soft tray, white active pill, muted counts. Scrolls sideways without a scrollbar. */
export function SegmentedTabs({ items, value, onChange, label, className }: {
  items: SegmentItem[]; value: string; onChange: (v: string) => void; label: string; className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        "inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-xl bg-muted p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.value)}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
              active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {it.label}
            {it.count !== undefined && <span className={cn("text-xs tabular-nums", active ? "text-foreground/70" : "text-muted-foreground/80")}>{it.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
