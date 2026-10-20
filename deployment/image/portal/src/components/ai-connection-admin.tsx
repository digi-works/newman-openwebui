"use client";

import { useState } from "react";
import { Check, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AiStatus } from "@/lib/ai-connection";

/** The organisation's own AI key. Write-only: once saved it is never shown again, only its last four characters. */
export function AiConnectionAdmin({ initial, secretsReady, memoryOn }: { initial: AiStatus | null; secretsReady: boolean; memoryOn: boolean }) {
  const [memory, setMemory] = useState(memoryOn);
  const [status, setStatus] = useState(initial);
  const [key, setKey] = useState("");
  const [base, setBase] = useState(initial?.baseUrl ?? "https://api.openai.com/v1");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(kind: string, path: string, init: RequestInit, onOk?: (d: Record<string, unknown>) => string | void) {
    setBusy(kind); setMsg(null);
    const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json" } }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) : {};
    setBusy(null);
    if (d.status) setStatus(d.status);
    if (!res || !res.ok) { setMsg({ ok: false, text: d.error ?? "That did not work. Try again." }); return; }
    const note = onOk?.(d);
    if (note) setMsg({ ok: true, text: note });
  }

  const save = () => run("save", "/api/admin/ai", { method: "PUT", body: JSON.stringify({ apiKey: key, baseUrl: base }) }, () => { setKey(""); return "Key saved. It is stored encrypted and will not be shown again. Test it next."; });
  const test = (deep: boolean) => run("test" + deep, "/api/admin/ai/test", { method: "POST", body: JSON.stringify({ deep }) }, (d) => {
    const r = d.result as { ok: boolean; message: string };
    setMsg({ ok: r.ok, text: r.message });
  });
  const apply = () => run("apply", "/api/admin/ai/apply", { method: "POST", body: JSON.stringify({ dryRun: false }) }, (d) => (d.changed ? "The AI service is now using this key." : "The AI service already uses this key."));

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AI connection</h1>
        <p className="text-sm text-muted-foreground">Your organisation provides its own AI provider key. Digi stores it encrypted, never shows it again, and checks it for you.</p>
      </div>

      {!secretsReady && <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">This server has no secret key set, so keys cannot be stored yet. Ask whoever runs the server.</p>}

      {status?.alert && (
        <p role="alert" className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          {status.alert.kind === "key_rejected" ? "The AI provider rejected the key recently. People will see errors until it is replaced." : "The AI provider has been rate limiting this key. People may see “AI quota is busy”."}
        </p>
      )}

      <section className="space-y-4 rounded-2xl border bg-card p-5">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">Current key</span>
          <span className="text-muted-foreground">{status?.configured ? <>ending in <b className="font-mono">{status.last4}</b></> : "none saved"}</span>
        </div>
        <div className="space-y-1.5"><label htmlFor="base" className="text-sm font-medium">Provider address</label><Input id="base" value={base} onChange={(e) => setBase(e.target.value)} placeholder="https://api.openai.com/v1" /></div>
        <div className="space-y-1.5">
          <label htmlFor="key" className="text-sm font-medium">{status?.configured ? "Replace the key" : "API key"}</label>
          <Input id="key" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste the key. It cannot be viewed again." />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={!key || busy !== null || !secretsReady} onClick={save}>{busy === "save" && <Loader2 className="animate-spin" />} Save key</Button>
          <Button variant="outline" disabled={!status?.configured || busy !== null} onClick={() => test(false)}>{busy === "testfalse" && <Loader2 className="animate-spin" />} Test connection</Button>
          <Button variant="outline" disabled={!status?.configured || busy !== null} onClick={() => test(true)} title="Makes one tiny request to read your provider's rate limits">{busy === "testtrue" && <Loader2 className="animate-spin" />} Test and read limits</Button>
          <Button variant="outline" disabled={!status?.configured || busy !== null} onClick={apply} title="Puts the saved key into the AI service">{busy === "apply" && <Loader2 className="animate-spin" />} Use this key</Button>
        </div>
        {msg && <p role="status" className={msg.ok ? "flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-300" : "text-sm text-destructive"}>{msg.ok && <Check className="size-4" />}{msg.text}</p>}
      </section>

      <section className="space-y-2 rounded-2xl border bg-card p-5 text-sm">
        <div className="flex items-center justify-between">
          <div className="font-medium">Memory</div>
          <Button size="sm" variant="outline" onClick={async () => {
            const res = await fetch("/api/admin/memory", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !memory }) }).catch(() => null);
            if (res?.ok) setMemory(!memory);
          }}>{memory ? "Switch off" : "Switch on"}</Button>
        </div>
        <p className="text-muted-foreground">{memory ? "Digi keeps short notes people ask it to remember, and people can see and delete them." : "Memory is off: Digi does not add or use notes for anyone."}</p>
      </section>

      <section className="space-y-2 rounded-2xl border bg-card p-5 text-sm">
        <div className="font-medium">Is this enough for your people?</div>
        <p className="text-muted-foreground">
          You have {status?.sizing.users.toLocaleString() ?? 0} active people. At the busiest moment that is roughly {status?.sizing.estimatedTokensPerMin.toLocaleString() ?? 0} tokens a minute.
          {status?.check?.limits?.tokensPerMin ? <> Your provider allows {status.check.limits.tokensPerMin.toLocaleString()} a minute.</> : <> Use “Test and read limits” to see what your provider allows.</>}
        </p>
        {status?.sizing.warning && <p role="alert" className="text-amber-700 dark:text-amber-300">{status.sizing.warning}</p>}
      </section>
    </div>
  );
}
