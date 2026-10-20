"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Row = { id: string; name: string; latest: number; status: string; published: number | null; updated: string };

/** Workers: the list, and the plain-English builder. The builder only ever makes a draft; a person must review it before it can be published. */
export function WorkersHome({ initial }: { initial: Row[] }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; problems?: string[] } | null>(null);

  async function generate() {
    setBusy(true); setError(null);
    const res = await fetch("/api/platform/workers/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request: text }) }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res || !res.ok) { setError({ message: d.error ?? "The builder failed.", problems: d.problems }); return; }
    router.push(`/platform/workers/${d.workerId}`);
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3 rounded-2xl border bg-card p-5">
        <h1 className="text-xl font-semibold">Create a Worker from plain English</h1>
        <p className="text-sm text-muted-foreground">Describe what the Worker should do for a university. You get a draft to review, test as different people, and edit. Nothing is published until a person has reviewed it.</p>
        <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="A Room Booking Worker that helps people find a free room, request it, and cancel it. If someone needs a room that is already being asked for by someone else, it can ask for an override that another person must approve." />
        {error && <div role="alert" className="text-sm text-destructive">{error.message}{error.problems?.map((p) => <div key={p}>· {p}</div>)}</div>}
        <Button disabled={busy || text.trim().length < 20} onClick={generate}>{busy ? <Loader2 className="animate-spin" /> : <Sparkles />} Create draft</Button>
      </section>

      <section className="rounded-2xl border bg-card">
        <div className="border-b px-5 py-3.5 text-sm font-semibold">Workers</div>
        {initial.length === 0 ? <p className="px-5 py-8 text-center text-sm text-muted-foreground">No Workers yet.</p> : (
          <ul className="divide-y">
            {initial.map((w) => (
              <li key={w.id}>
                <Link href={`/platform/workers/${w.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 text-sm hover:bg-muted/40">
                  <div><div className="font-medium">{w.name}</div><div className="font-mono text-xs text-muted-foreground">{w.id}</div></div>
                  <div className="text-muted-foreground">v{w.latest} · {w.status.replace("_", " ")}{w.published ? ` · published v${w.published}` : ""}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
