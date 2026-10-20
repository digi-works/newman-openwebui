"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Room } from "@/lib/rooms";
import { cn } from "@/lib/utils";

type Query = { purpose: string; date: string; start: string; end: string; people: number; building: string; needs: string[] };

/** Request a room without chat: find free rooms for a time and size, then ask for one. A person who can approve decides it. */
export function RoomRequestForm({ buildings, needs, today }: { buildings: string[]; needs: string[]; today: string }) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState<"search" | string | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ rooms: Room[]; note: string; q: Query } | null>(null);
  const [done, setDone] = useState<{ ref: string; room: string; q: Query } | null>(null);
  // Results belong to the search that produced them. Once the form changes they no longer match it, so they go,
  // and a request can never use an older search's date, time or size (QA DEF-11, DEF-12).
  const [stale, setStale] = useState(false);
  const clearResults = () => { if (result) { setResult(null); setStale(true); } };
  // What is wrong with the form, by field. Shown in the form and on the fields themselves rather than the browser's
  // passing bubble, and kept up to date as the person fixes it (QA DEF-13).
  const [problems, setProblems] = useState<Record<string, string>>({});
  function check(f: FormData) {
    const v = (k: string) => String(f.get(k) ?? "").trim();
    const p: Record<string, string> = {};
    if (!v("purpose")) p.purpose = "Say what the booking is for.";
    if (!v("date")) p.date = "Pick a date.";
    else if (v("date") < today) p.date = "Pick today or a later date.";
    if (!v("start")) p.start = "Set a start time.";
    if (!v("end")) p.end = "Set an end time.";
    else if (v("start") && v("end") <= v("start")) p.end = "The end time must be after the start time.";
    const n = Number(v("people"));
    if (!v("people") || !Number.isInteger(n) || n < 1 || n > 500) p.people = "Say how many people, from 1 to 500.";
    return p;
  }
  const bad = (k: string) => (problems[k] ? true : undefined);

  async function search(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const q: Query = {
      purpose: String(f.get("purpose") ?? "").trim(), date: String(f.get("date")), start: String(f.get("start")), end: String(f.get("end")),
      people: Number(f.get("people")), building: String(f.get("building") ?? ""), needs: chosen,
    };
    const p = check(f);
    setProblems(p);
    // a search that cannot run also removes the old results, so they cannot be requested (QA DEF-12)
    if (Object.keys(p).length) { clearResults(); return; }
    setBusy("search"); setError(""); setResult(null); setStale(false);
    const res = await fetch("/api/rooms/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(q) }).catch(() => null);
    const out = res ? await res.json().catch(() => ({})) : {};
    setBusy(null);
    if (!res || !res.ok) { setError(out.error ?? "Could not search rooms."); return; }
    setResult({ rooms: out.rooms, note: out.note, q });
  }

  async function request(room: Room) {
    if (!result) return;
    setBusy(room.id); setError("");
    const q = result.q;
    const res = await fetch("/api/bookings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomId: room.id, date: q.date, start: q.start, end: q.end, purpose: q.purpose, people: q.people, needs: q.needs }) }).catch(() => null);
    const out = res ? await res.json().catch(() => ({})) : {};
    setBusy(null);
    if (!res || !res.ok) { setError(out.error ?? "Could not send the request."); return; }
    setDone({ ref: out.booking.ref, room: room.name, q });
  }

  if (done) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border bg-card p-8 text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300"><Check /></div>
        <h1 className="mt-4 text-xl font-semibold">Request sent</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {done.room} on {new Date(done.q.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}, {done.q.start} to {done.q.end}. Reference <b>{done.ref}</b>.
          An approver will decide it, and you will see the answer here in the app.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Button render={<Link href="/bookings" />}>See my requests</Button>
          <Button variant="outline" onClick={() => { setDone(null); setResult(null); }}>Request another</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Request a room</h1>
        <p className="text-sm text-muted-foreground">Tell us when and how many, see what is free, and ask for a room. Requests hold the room for a few days while an approver decides.</p>
      </div>

      <form noValidate onSubmit={search} onChange={(e) => { clearResults(); if (Object.keys(problems).length) setProblems(check(new FormData(e.currentTarget))); }} className="space-y-4 rounded-2xl border bg-card p-5">
        <div className="space-y-1.5"><label htmlFor="purpose" className="text-sm font-medium">What is the booking for?</label><Input id="purpose" name="purpose" required maxLength={200} placeholder="Study group, club meeting…" aria-invalid={bad("purpose")} /></div>
        <div className="grid gap-4 sm:grid-cols-4">
          <div className="space-y-1.5"><label htmlFor="date" className="text-sm font-medium">Date</label><Input id="date" name="date" type="date" required min={today} defaultValue={today} aria-invalid={bad("date")} /></div>
          <div className="space-y-1.5"><label htmlFor="start" className="text-sm font-medium">Start</label><Input id="start" name="start" type="time" required defaultValue="14:00" aria-invalid={bad("start")} /></div>
          <div className="space-y-1.5"><label htmlFor="end" className="text-sm font-medium">End</label><Input id="end" name="end" type="time" required defaultValue="15:00" aria-invalid={bad("end")} /></div>
          <div className="space-y-1.5"><label htmlFor="people" className="text-sm font-medium">People</label><Input id="people" name="people" type="number" required min={1} max={500} defaultValue={6} aria-invalid={bad("people")} /></div>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="building" className="text-sm font-medium">Preferred building</label>
          <select id="building" name="building" className="h-9 w-full rounded-md border bg-background px-2 text-sm"><option value="">No preference</option>{buildings.map((b) => <option key={b}>{b}</option>)}</select>
        </div>
        <div className="space-y-1.5">
          <span className="text-sm font-medium">Anything the room needs?</span>
          <div className="flex flex-wrap gap-2">
            {needs.map((n) => (
              <button type="button" key={n} aria-pressed={chosen.includes(n)} onClick={() => { clearResults(); setChosen((c) => (c.includes(n) ? c.filter((x) => x !== n) : [...c, n])); }}
                className={cn("rounded-full border px-3 py-1 text-sm transition-colors", chosen.includes(n) ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted")}>{n}</button>
            ))}
          </div>
        </div>
        {stale && <p role="status" className="rounded-lg border bg-muted px-3 py-2 text-sm text-muted-foreground">You changed the search. Press Find available rooms again to see what is free.</p>}
        {Object.keys(problems).length > 0 && (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {Object.values(problems).map((m) => <p key={m}>{m}</p>)}
          </div>
        )}
        {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={busy !== null}>{busy === "search" && <Loader2 className="animate-spin" />} Find available rooms</Button>
      </form>

      {result && (
        <section className="rounded-2xl border bg-card">
          <div className="border-b px-5 py-3.5 text-sm font-semibold">
            Available rooms
            <span className="font-normal text-muted-foreground">
              {" · "}{new Date(result.q.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}, {result.q.start}–{result.q.end}, {result.q.people} {result.q.people === 1 ? "person" : "people"}
            </span>
          </div>
          {result.note && <p className="px-5 pt-3 text-sm text-muted-foreground">{result.note}</p>}
          {result.rooms.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">No rooms are free for that time. Try another time or fewer needs.</p>
          ) : (
            <ul className="divide-y">
              {result.rooms.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div>
                    <div className="font-medium">{r.name}</div>
                    <div className="text-sm text-muted-foreground">{r.building} · fits {r.capacity} · {r.tags.join(", ") || r.features}</div>
                  </div>
                  <Button disabled={busy !== null} onClick={() => request(r)}>{busy === r.id && <Loader2 className="animate-spin" />} Request this room</Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
