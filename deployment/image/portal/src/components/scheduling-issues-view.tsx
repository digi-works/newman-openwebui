"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Lightbulb, Loader2, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Run, SectionInfo } from "@/lib/course-scheduling";
import { type Category, type Finding, category, describe, group, sectionName, slotLabel } from "@/lib/scheduling-issues";
import { cn } from "@/lib/utils";

type Props =
  | { state: "off" | "empty" | "error" }
  | { state: "ok"; runs: Run[]; run: Run; findings: Finding[]; sections: Record<string, SectionInfo>; canGenerate?: boolean };

const TONE: Record<Category, string> = {
  clash: "text-red-700 dark:text-red-400",
  missing: "text-amber-700 dark:text-amber-400",
  guessed: "text-blue-700 dark:text-blue-400",
  wish: "text-muted-foreground",
  practice: "text-emerald-700 dark:text-emerald-400",
};

/** Builds a new draft from the timetable on screen with the solver, then opens it. The timetable on screen is not changed. */
function GenerateBar({ run }: { run: Run }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function go() {
    setBusy(true); setMsg(null);
    const res = await fetch("/api/scheduling/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fromRun: run.id }) }).catch(() => null);
    const out = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res || !res.ok) { setMsg({ ok: false, text: out.error ?? "That did not work." }); return; }
    const s = out.summary;
    setMsg({ ok: true, text: `Draft ${out.run_id} is ready in ${out.seconds}s: ${s.real_clashes} real clashes, ${out.moved_time.length + out.moved_room.length} changes, ${out.unplaced.length} not placed.` });
    router.push(`/scheduling/issues?run=${out.run_id}`);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-card px-4 py-3">
      <Sparkles className="size-4 text-primary" />
      <p className="flex-1 text-sm">
        <span className="font-medium">Generate a draft</span>
        <span className="text-muted-foreground"> from {run.label}: the solver fixes clashes and changes as little as it can. This timetable stays as it is.</span>
      </p>
      <Button size="sm" onClick={() => void go()} disabled={busy}>{busy ? <><Loader2 className="animate-spin" /> Building, up to a minute</> : "Generate draft"}</Button>
      {msg && <p role={msg.ok ? "status" : "alert"} className={cn("basis-full text-sm", msg.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive")}>{msg.text}</p>}
    </div>
  );
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <Header />
      <div className="rounded-2xl border bg-card px-6 py-10 text-center">
        <p className="font-medium">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}

function Header({ right }: { right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="flex-1">
        <h1 className="text-2xl font-semibold tracking-tight">Issues</h1>
        <p className="text-sm text-muted-foreground">Like a spell-checker for timetables: every problem in plain words, with a checked fix where there is one.</p>
      </div>
      {right}
    </div>
  );
}

function SectionLine({ id, info }: { id: string; info?: SectionInfo }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
      <span className="font-mono font-medium">{sectionName(id)}</span>
      {info && <span className="text-muted-foreground">{info.title}</span>}
      {info && (
        <span className="text-muted-foreground">
          · {info.when ? slotLabel(info.when.days, info.when.start, info.when.end) : "no set time"}
          {info.room ? ` · ${info.room}` : ""}
          {` · ${info.instructor ?? "no instructor"}`}
          {info.enrolled != null ? ` · ${info.enrolled} enrolled` : ""}
        </span>
      )}
      {info?.note && <span className="basis-full text-xs text-primary">Solver: {info.note.replace(/\b\d{4}[A-Z]{2}-[A-Z]+\d+-\w+\b/g, sectionName)}</span>}
    </div>
  );
}

function FindingRow({ f, sections }: { f: Finding; sections: Record<string, SectionInfo> }) {
  const shown = f.sections.slice(0, 6);
  return (
    <li className="space-y-2 px-5 py-4">
      <div className="space-y-1">
        {shown.map((id) => <SectionLine key={id} id={id} info={sections[id]} />)}
        {f.sections.length > shown.length && <p className="text-xs text-muted-foreground">and {f.sections.length - shown.length} more sections</p>}
      </div>
      <p className="text-sm text-muted-foreground">{describe(f)}</p>
      {f.basis === "estimated" && <p className="text-xs text-blue-700 dark:text-blue-400">Rests on guessed data.</p>}
      {f.fixes.length === 0 && category(f) === "clash" && (
        <p className="text-sm text-amber-700 dark:text-amber-400">No safe fix found: every free option would cause another problem, so a person needs to decide.</p>
      )}
      {f.fixes.length > 0 && (
        <div className="rounded-xl border border-emerald-600/20 bg-emerald-50 px-3 py-2 dark:bg-emerald-950/30">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-emerald-800 dark:text-emerald-300"><Lightbulb className="size-3.5" /> Suggested fixes, checked against the whole timetable</p>
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            {f.fixes.map((x, i) => <li key={i}>{x.text.replace(/\b\d{4}[A-Z]{2}-[A-Z]+\d+-\w+\b/g, sectionName)}</li>)}
          </ul>
        </div>
      )}
    </li>
  );
}

export function SchedulingIssuesView(props: Props) {
  const [tab, setTab] = useState<Category>("clash");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState("");
  const ok = props.state === "ok";
  const groups = useMemo(() => (ok ? group(props.findings) : []), [ok, props]);

  if (props.state !== "ok") {
    const [title, body] = {
      off: ["Course scheduling isn't connected", "Set COURSE_SCHEDULING_DATABASE_URL to the course scheduler's database to see its checks here."],
      error: ["Couldn't reach the course scheduling data", "Try again in a moment. If it keeps happening, check COURSE_SCHEDULING_DATABASE_URL."],
      empty: ["No timetable yet", "Load a term with the course scheduler, then check it."],
    }[props.state];
    return <Notice title={title}>{body}</Notice>;
  }

  const { runs, run, sections } = props;
  const current = groups.find((g) => g.value === tab)!;
  const needle = q.trim().toLowerCase();
  const matches = (f: Finding) => !needle || f.detail.toLowerCase().includes(needle) ||
    f.sections.some((id) => `${sectionName(id)} ${sections[id]?.title ?? ""} ${sections[id]?.room ?? ""} ${sections[id]?.instructor ?? ""}`.toLowerCase().includes(needle));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <Header right={
        <div className="flex flex-wrap gap-2">
          {runs.map((r) => (
            <Link key={r.id} href={`/scheduling/issues?run=${r.id}`}
              className={cn("rounded-lg border px-3 py-1.5 text-sm", r.id === run.id ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}>
              {r.label}
            </Link>
          ))}
        </div>
      } />

      {props.canGenerate && <GenerateBar run={run} />}

      {!run.checked ? (
        <p className="rounded-2xl border bg-card px-5 py-10 text-center text-sm text-muted-foreground">This timetable hasn&apos;t been checked yet.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {groups.map((g) => (
              <button key={g.value} onClick={() => setTab(g.value)} aria-pressed={tab === g.value}
                className={cn("rounded-2xl border bg-card p-4 text-left transition-colors hover:bg-muted/60", tab === g.value && "ring-2 ring-primary")}>
                <div className="text-xs text-muted-foreground">{g.label}</div>
                <div className={cn("text-2xl font-semibold tabular-nums", TONE[g.value])}>{g.count}</div>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <p className="flex-1 text-sm text-muted-foreground">{current.blurb}</p>
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input aria-label="Search" placeholder="Search section, room or instructor" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>

          {current.rules.length === 0 ? (
            <p className="rounded-2xl border bg-card px-5 py-10 text-center text-sm text-muted-foreground">{tab === "clash" ? "No real clashes in this timetable." : "Nothing here."}</p>
          ) : (
            <div className="space-y-3">
              {current.rules.map(({ rule, title, items }) => {
                const list = items.filter(matches);
                if (needle && list.length === 0) return null;
                const isOpen = open[rule] ?? (tab === "clash" || tab === "missing");
                return (
                  <section key={rule} className="rounded-2xl border bg-card">
                    <button className="flex w-full items-center gap-3 px-5 py-3 text-left" onClick={() => setOpen((o) => ({ ...o, [rule]: !isOpen }))} aria-expanded={isOpen}>
                      <span className="font-medium">{title}</span>
                      <span className="text-sm text-muted-foreground tabular-nums">{list.length}</span>
                      <ChevronDown className={cn("ml-auto size-4 transition-transform", isOpen && "rotate-180")} />
                    </button>
                    {isOpen && <ul className="divide-y border-t">{list.map((f, i) => <FindingRow key={i} f={f} sections={sections} />)}</ul>}
                  </section>
                );
              })}
            </div>
          )}
          <p className="text-xs text-muted-foreground">Nothing on this page changes a timetable. Fixes are suggestions; applying them comes with drafts.</p>
        </>
      )}
    </div>
  );
}
