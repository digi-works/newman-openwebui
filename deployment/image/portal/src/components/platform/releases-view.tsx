"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { campusTime } from "@/lib/campus-time";

type Rel = { release_id: string; seq: number; channel: string; status: string; security_critical: boolean; notes: string; digest: string; key_id: string; signed_at: string; manifest: Record<string, unknown> };

/** Releases: signed bundles of published Worker versions. Signing and revoking are platform-admin actions and are audited. */
export function ReleasesView({ releases, published, signerReady, isAdmin }: { releases: Rel[]; published: { worker_id: string; version: number; name: string }[]; signerReady: boolean; isAdmin: boolean }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [channel, setChannel] = useState("stable");
  const [critical, setCritical] = useState(false);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; problems?: string[] } | null>(null);

  async function call(kind: string, path: string, body: unknown, ok: string) {
    setBusy(kind); setMsg(null);
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) : {};
    setBusy(null);
    if (!res || !res.ok) { setMsg({ ok: false, text: d.error ?? "That did not work.", problems: d.problems }); return; }
    setMsg({ ok: true, text: ok }); router.refresh();
  }
  const chosen = published.filter((p) => picked[`${p.worker_id}@${p.version}`]).map((p) => ({ worker_id: p.worker_id, version: p.version }));

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Releases</h1>
      {msg && <div role="status" className={msg.ok ? "text-sm text-emerald-700 dark:text-emerald-300" : "text-sm text-destructive"}>{msg.text}{msg.problems?.map((p) => <div key={p}>· {p}</div>)}</div>}
      {isAdmin ? (
        <section className="space-y-3 rounded-2xl border bg-card p-5">
          <div className="font-medium">Sign a new release</div>
          {!signerReady && <p role="alert" className="text-sm text-destructive">No release signing key is installed. Run the key ceremony (scripts/studio-keys.mjs).</p>}
          {published.length === 0 ? <p className="text-sm text-muted-foreground">Publish a Worker version first.</p> : published.map((p) => (
            <label key={`${p.worker_id}@${p.version}`} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!picked[`${p.worker_id}@${p.version}`]} onChange={(e) => setPicked({ ...picked, [`${p.worker_id}@${p.version}`]: e.target.checked })} /> {p.name} <span className="text-muted-foreground">version {p.version}</span></label>
          ))}
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">Channel <select className="h-9 rounded-md border bg-background px-2" value={channel} onChange={(e) => setChannel(e.target.value)}><option>stable</option><option>preview</option></select></label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={critical} onChange={(e) => setCritical(e.target.checked)} /> Security-critical (customers get 7 days)</label>
          </div>
          <Input placeholder="Release notes (customers see these)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <Button disabled={busy !== null || !signerReady || chosen.length === 0} onClick={() => call("sign", "/api/platform/releases", { workers: chosen, channel, notes, securityCritical: critical }, "Release signed.")}>{busy === "sign" && <Loader2 className="animate-spin" />} Sign release</Button>
        </section>
      ) : <p className="text-sm text-muted-foreground">Only a platform admin can sign or revoke releases.</p>}

      <section className="rounded-2xl border bg-card">
        <div className="border-b px-5 py-3.5 text-sm font-semibold">Signed releases</div>
        {releases.length === 0 ? <p className="px-5 py-8 text-center text-sm text-muted-foreground">None yet.</p> : (
          <ul className="divide-y">
            {releases.map((r) => (
              <li key={r.release_id} className="space-y-1 px-5 py-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><b>{r.release_id}</b> · {r.channel}{r.security_critical ? " · security" : ""}</div>
                  <span className={r.status === "signed" ? "text-emerald-700 dark:text-emerald-300" : "text-destructive"}>{r.status}</span>
                </div>
                <div className="text-muted-foreground">{((r.manifest.workers as { name: string; version: number }[]) ?? []).map((w) => `${w.name} v${w.version}`).join(", ")}</div>
                <div className="break-all font-mono text-xs text-muted-foreground">key {r.key_id} · digest {r.digest.slice(0, 16)}… · {campusTime(r.signed_at)}</div>
                {isAdmin && r.status === "signed" && <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => { const reason = window.prompt("Why is this release being revoked?"); if (reason) void call("rev" + r.release_id, `/api/platform/releases/${r.release_id}/revoke`, { reason }, "Revoked. Stacks learn of it on their next check."); }}>Revoke</Button>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
