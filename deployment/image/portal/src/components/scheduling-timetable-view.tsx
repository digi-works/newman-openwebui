"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Info, X } from "lucide-react";
import { RunPicker } from "@/components/scheduling-run-picker";
import { SegmentedTabs } from "@/components/segmented-tabs";
import type { Run } from "@/lib/course-scheduling";
import { ruleTitle, sectionName } from "@/lib/scheduling-issues";
import { type Block, DAY_NAME, DAYS, type Meeting, type View, hasClash, hours, layout, options, pick, time12 } from "@/lib/timetable";
import { cn } from "@/lib/utils";

type Groups = Record<string, { label: string; courses: string[] }>;
type Props =
  | { state: "off" | "empty" | "error" }
  | { state: "ok"; runs: Run[]; run: Run; rows: Meeting[]; groups: Groups; view: View; choice: string | null };

const VIEWS: { value: View; label: string }[] = [
  { value: "room", label: "Room" }, { value: "instructor", label: "Instructor" }, { value: "subject", label: "Subject" }, { value: "group", label: "Student group" },
];
const PX = 1.05;   // pixels per minute

function Title() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Timetable</h1>
      <p className="text-sm text-muted-foreground">The week for one room, instructor, subject or student group. Click a class to see why it is there.</p>
    </div>
  );
}

const when = (m: Meeting) => (m.days && m.start && m.end ? `${m.days.split("").map((d) => DAY_NAME[d]).join(" ")} ${time12(m.start)} to ${time12(m.end)}` : "No set time");

function Details({ m, onClose }: { m: Meeting; onClose: () => void }) {
  const hard = m.problems.filter((p) => p.basis === "real");
  return (
    <aside className="space-y-3 rounded-2xl border bg-card p-4 text-sm lg:sticky lg:top-4">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <div className="font-mono font-semibold">{sectionName(m.id)}</div>
          <div className="text-muted-foreground">{m.title}</div>
        </div>
        <button aria-label="Close" onClick={onClose} className="rounded-md p-1 hover:bg-muted"><X className="size-4" /></button>
      </div>
      <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5">
        <dt className="text-muted-foreground">When</dt><dd>{when(m)}{m.half && <span className="text-muted-foreground"> · {m.half === "first" ? "first" : "second"} 8 weeks</span>}</dd>
        <dt className="text-muted-foreground">Room</dt><dd>{m.room ?? (m.mode === "ONLINE_LIVE" ? "Online, live" : "None")}</dd>
        <dt className="text-muted-foreground">Instructor</dt><dd>{m.instructor ?? "Not named yet"}</dd>
        <dt className="text-muted-foreground">Enrolled</dt><dd>{m.enrolled ?? "?"} <span className="text-muted-foreground">of {m.seats} seats (estimated)</span></dd>
        {m.together && <><dt className="text-muted-foreground">Taught with</dt><dd>other sections at the same time, as one class</dd></>}
      </dl>
      {m.reason && <p className="rounded-lg bg-primary/5 px-3 py-2 text-primary"><Info className="mr-1 inline size-3.5" />Solver: {m.reason}</p>}
      {hard.length > 0 ? (
        <div className="rounded-lg border border-red-600/20 bg-red-50 px-3 py-2 dark:bg-red-950/30">
          <p className="mb-1 flex items-center gap-1.5 font-medium text-red-800 dark:text-red-300"><AlertTriangle className="size-3.5" /> Problems</p>
          <ul className="list-disc pl-5">{hard.map((p, i) => <li key={i}>{ruleTitle(p.rule)}</li>)}</ul>
        </div>
      ) : <p className="text-emerald-700 dark:text-emerald-400">No problems on real data.</p>}
    </aside>
  );
}

function BlockView({ b, top, view, onPick, active }: { b: Block; top: number; view: View; onPick: (m: Meeting) => void; active: boolean }) {
  const m = b.members[0];
  const clash = b.members.some(hasClash);
  const width = 100 / b.lanes;
  const other = view === "room" ? m.instructor : view === "instructor" ? m.room : [m.room, m.instructor].filter(Boolean).join(" · ");
  return (
    <button onClick={() => onPick(m)} title={b.members.map((x) => `${sectionName(x.id)} ${x.title}`).join("\n")}
      className={cn("absolute overflow-hidden rounded-md border px-1.5 py-1 text-left text-[11px] leading-tight shadow-sm transition-colors",
        "bg-primary/10 text-foreground hover:bg-primary/20",
        b.members.length > 1 && "border-dashed border-primary/60",
        m.half && "bg-primary/5",
        clash ? "border-2 border-red-600" : "border-primary/30",
        active && "ring-2 ring-primary")}
      style={{ top: (b.start - top) * PX, height: Math.max(18, (b.end - b.start) * PX - 2), left: `calc(${b.lane * width}% + 2px)`, width: `calc(${width}% - 4px)` }}>
      <div className="truncate font-semibold">{b.members.map((x) => sectionName(x.id)).join(" + ")}</div>
      <div className="truncate text-muted-foreground">{time12(m.start!)}–{time12(m.end!)}{m.half ? ` · ${m.half === "first" ? "1st" : "2nd"} 8 wks` : ""}</div>
      {other && <div className="truncate text-muted-foreground">{other}</div>}
    </button>
  );
}

export function SchedulingTimetableView(props: Props) {
  const ok = props.state === "ok";
  const [view, setView] = useState<View>(ok ? props.view : "room");
  const [choice, setChoice] = useState<string | null>(ok ? props.choice : null);
  const [picked, setPicked] = useState<Meeting | null>(null);

  const rows = useMemo(() => (ok ? props.rows : []), [ok, props]);
  const groups = useMemo(() => (ok ? props.groups : {}), [ok, props]);
  const opts = useMemo(() => options(rows.filter((r) => r.days), view, groups), [rows, view, groups]);
  const key = choice && opts.some((o) => o.value === choice) ? choice : opts[0]?.value ?? null;   // first in the list until one is chosen
  const shown = useMemo(() => (key ? pick(rows, view, key, groups) : []), [rows, view, key, groups]);
  const blocks = useMemo(() => layout(shown), [shown]);

  if (props.state !== "ok") {
    const text = { off: "Course scheduling isn't connected.", error: "Couldn't reach the course scheduling data. Try again in a moment.", empty: "No timetable yet." }[props.state];
    return <div className="mx-auto flex w-full max-w-6xl flex-col gap-6"><Title /><p className="rounded-2xl border bg-card px-6 py-10 text-center text-sm text-muted-foreground">{text}</p></div>;
  }
  const { runs, run } = props;

  const remember = (v: View, k: string | null) => {
    const q = new URLSearchParams({ run: String(run.id), view: v, ...(k ? { key: k } : {}) });
    window.history.replaceState(null, "", `/scheduling/timetable?${q}`);
  };
  const [lo, hi] = hours(blocks);
  const days = DAYS.filter((d) => d !== "S" && d !== "U" || blocks.some((b) => b.day === d));
  const noTime = shown.filter((m) => !m.days);
  const unplaced = noTime.filter((m) => m.needsTime);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex-1"><Title /></div>
        <RunPicker runs={runs} run={run} href={(id) => `/scheduling/timetable?run=${id}&view=${view}${key ? `&key=${encodeURIComponent(key)}` : ""}`} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SegmentedTabs label="Look at it by" items={VIEWS} value={view} onChange={(v) => { setView(v as View); setChoice(null); setPicked(null); remember(v as View, null); }} />
        <select aria-label={`Choose a ${view}`} value={key ?? ""} onChange={(e) => { setChoice(e.target.value); setPicked(null); remember(view, e.target.value); }}
          className="h-9 min-w-64 rounded-lg border bg-card px-3 text-sm">
          {opts.map((o) => <option key={o.value} value={o.value}>{o.label} ({o.count})</option>)}
        </select>
        <div className="ml-auto flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="inline-block size-3 rounded-sm border border-primary/30 bg-primary/10" />Class</span>
          <span className="flex items-center gap-1.5"><span className="inline-block size-3 rounded-sm border border-dashed border-primary/60 bg-primary/10" />Taught together</span>
          <span className="flex items-center gap-1.5"><span className="inline-block size-3 rounded-sm border-2 border-red-600 bg-primary/10" />Real clash</span>
        </div>
      </div>

      <div className={cn("grid gap-4", picked ? "lg:grid-cols-[1fr_20rem]" : "")}>
        <div className="overflow-x-auto rounded-2xl border bg-card">
          {blocks.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">Nothing here meets at a set time.</p>
          ) : (
            <div className="grid min-w-[640px]" style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, 1fr)` }}>
              <div className="border-b" />
              {days.map((d) => <div key={d} className="border-b border-l px-2 py-2 text-center text-xs font-medium text-muted-foreground">{DAY_NAME[d]}</div>)}
              <div className="relative" style={{ height: (hi - lo) * PX }}>
                {Array.from({ length: (hi - lo) / 60 }, (_, i) => (
                  <div key={i} className="absolute right-2 -translate-y-1/2 text-[10px] text-muted-foreground" style={{ top: i * 60 * PX }}>{i ? time12(`${String((lo + i * 60) / 60).padStart(2, "0")}:00`) : ""}</div>
                ))}
              </div>
              {days.map((d) => (
                <div key={d} className="relative border-l" style={{ height: (hi - lo) * PX }}>
                  {Array.from({ length: (hi - lo) / 60 }, (_, i) => <div key={i} className="absolute inset-x-0 border-t border-dashed border-border/60" style={{ top: i * 60 * PX }} />)}
                  {blocks.filter((b) => b.day === d).map((b) => (
                    <BlockView key={b.key} b={b} top={lo} view={view} onPick={setPicked} active={!!picked && b.members.some((x) => x.id === picked.id)} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        {picked && <Details m={picked} onClose={() => setPicked(null)} />}
      </div>

      {noTime.length > 0 && (
        <section className="rounded-2xl border bg-card px-5 py-4">
          <h2 className="text-sm font-semibold">No set time <span className="font-normal text-muted-foreground">({noTime.length})</span></h2>
          <p className="mb-2 text-xs text-muted-foreground">Online on their own time, arranged (internships, applied lessons, clinicals){unplaced.length ? ", and classes that need a time but have none" : ""}.</p>
          <ul className="flex flex-wrap gap-2">
            {noTime.map((m) => (
              <li key={m.id}>
                <button onClick={() => setPicked(m)} className={cn("rounded-md border px-2 py-1 text-xs hover:bg-muted", m.needsTime && "border-amber-500 text-amber-800 dark:text-amber-300")}>
                  <span className="font-mono">{sectionName(m.id)}</span> <span className="text-muted-foreground">{m.needsTime ? "needs a time" : m.mode === "ONLINE_ASYNC" ? "online" : "arranged"}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="text-xs text-muted-foreground">Read only. To change a class, see its <Link href={`/scheduling/issues?run=${run.id}`} className="underline">issues</Link>; moving classes by hand comes next.</p>
    </div>
  );
}
