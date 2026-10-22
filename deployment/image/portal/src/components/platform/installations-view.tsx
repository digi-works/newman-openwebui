"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { campusTime } from "@/lib/campus-time";

type Inst = { id: string; label: string; status: string; enrolled_at: string; last_pull_at: string | null; digi_version: string | null; current_release: string | null; runtime_capabilities: Record<string, unknown> };
type Tok = { label: string; expires_at: string; used_at: string | null; installation_id: string | null };

/** Customer stacks that have enrolled, and the single-use tokens that enrol them. The platform sees only what a stack reports about itself, never customer data. */
export function InstallationsView({ installations, tokens, isAdmin }: { installations: Inst[]; tokens: Tok[]; isAdmin: boolean }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [minted, setMinted] = useState<{ token: string; expires_at: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function mint() {
    setBusy(true); setError(""); setMinted(null);
    const res = await fetch("/api/platform/enrollment-tokens", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label }) }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res || !res.ok) { setError(d.error ?? "That did not work."); return; }
    setMinted(d); setLabel(""); router.refresh();
  }
  async function revoke(id: string) {
    const reason = window.prompt("Why is this installation being revoked?");
    if (!reason) return;
    await fetch(`/api/platform/installations/${id}/revoke`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
    router.refresh();
  }

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Installations</h1>
      {isAdmin && (
        <section className="space-y-3 rounded-2xl border bg-card p-5">
          <div className="font-medium">Enrol a customer stack</div>
          <p className="text-sm text-muted-foreground">A token works once and expires in 24 hours. Give it to the customer&apos;s Admin; they enter it on Settings &gt; AI updates.</p>
          <div className="flex gap-2"><Input placeholder="Customer or stack label" value={label} onChange={(e) => setLabel(e.target.value)} /><Button disabled={busy || !label.trim()} onClick={mint}>{busy && <Loader2 className="animate-spin" />} Create token</Button></div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {minted && <div className="space-y-1 rounded-lg border bg-muted/40 p-3 text-sm"><div>Shown once. Copy it now.</div><div className="break-all font-mono text-xs">{minted.token}</div><div className="text-xs text-muted-foreground">Expires {campusTime(minted.expires_at)}</div></div>}
        </section>
      )}
      <section className="rounded-2xl border bg-card">
        <div className="border-b px-5 py-3.5 text-sm font-semibold">Enrolled stacks</div>
        {installations.length === 0 ? <p className="px-5 py-8 text-center text-sm text-muted-foreground">None yet.</p> : (
          <ul className="divide-y">
            {installations.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 text-sm">
                <div><div className="font-medium">{i.label} <span className="font-mono text-xs text-muted-foreground">{i.id}</span></div>
                  <div className="text-muted-foreground">Digi {i.digi_version ?? "?"} · release {i.current_release || "none"} · last seen {i.last_pull_at ? campusTime(i.last_pull_at) : "never"}</div></div>
                <div className="flex items-center gap-3"><span className={i.status === "active" ? "text-emerald-700 dark:text-emerald-300" : "text-destructive"}>{i.status}</span>
                  {isAdmin && i.status === "active" && <Button size="sm" variant="outline" onClick={() => revoke(i.id)}>Revoke</Button>}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {isAdmin && tokens.length > 0 && (
        <section className="rounded-2xl border bg-card">
          <div className="border-b px-5 py-3.5 text-sm font-semibold">Recent tokens</div>
          <ul className="divide-y text-sm">{tokens.map((t, i) => <li key={i} className="flex justify-between px-5 py-3"><span>{t.label}</span><span className="text-muted-foreground">{t.used_at ? `used by ${t.installation_id}` : new Date(t.expires_at) < new Date() ? "expired" : "unused"}</span></li>)}</ul>
        </section>
      )}
    </div>
  );
}
