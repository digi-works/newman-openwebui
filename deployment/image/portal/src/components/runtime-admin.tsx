"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RuntimeView } from "@/lib/stack/runtime-switch";

/** Which AI runtime this stack runs on. Open WebUI is the default; a switch is only accepted if the other runtime is healthy, supports what is installed and passes a test turn. */
export function RuntimeAdmin({ initial }: { initial: RuntimeView }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; problems?: string[] } | null>(null);

  async function choose(id: string) {
    setBusy(id); setMsg(null);
    const res = await fetch("/api/admin/runtime", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runtime: id }) }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) : {};
    setBusy(null);
    if (!res || !res.ok) { setMsg({ ok: false, text: d.error ?? "That did not work.", problems: d.problems }); return; }
    setMsg({ ok: true, text: `Now running on ${initial.options.find((o) => o.id === id)?.name}.` });
    router.refresh();
  }

  return (
    <section className="space-y-3 rounded-2xl border bg-card p-5 text-sm">
      <div className="font-medium">AI runtime</div>
      <p className="text-muted-foreground">The engine that runs Digi&apos;s conversations. Your people, permissions, conversations and history stay in Digi either way. Switching is checked first and can be undone.</p>
      {initial.options.map((o) => (
        <div key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
          <div>
            <div className="font-medium">{o.name} {initial.current === o.id && <span className="ml-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-300">in use</span>}</div>
            <div className={o.ok ? "text-muted-foreground" : "text-destructive"}>{o.detail}</div>
            {o.blockedBy.length > 0 && <div className="text-xs text-destructive">Cannot run what is installed (needs {o.blockedBy.join(", ")}).</div>}
          </div>
          {initial.current !== o.id && <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => choose(o.id)}>{busy === o.id && <Loader2 className="animate-spin" />} Switch to {o.name}</Button>}
        </div>
      ))}
      {msg && <div role="status" className={msg.ok ? "text-emerald-700 dark:text-emerald-300" : "text-destructive"}>{msg.text}{msg.problems?.map((p) => <div key={p}>· {p}</div>)}</div>}
    </section>
  );
}
