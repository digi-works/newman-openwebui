"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, RefreshCw, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { UpdatesView } from "@/lib/stack/admin";
import { campusTime } from "@/lib/campus-time";

const STATUS: Record<string, string> = {
  pending_approval: "Waiting for you", active: "Running", superseded: "Replaced", rolled_back: "Rolled back", rejected: "Not installed", revoked: "Withdrawn by the platform", failed: "Could not be set up",
};

/** AI updates: where the platform's releases arrive, what is waiting for approval, what is running, and which App each capability is on for. */
export function UpdatesAdmin({ initial }: { initial: UpdatesView | null }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const v = initial;
  if (!v) return <p className="p-6 text-sm text-muted-foreground">Updates are not available in demo mode.</p>;
  const id = v.identity;

  async function act(kind: string, path: string, method: string, body?: unknown, ok?: string) {
    setBusy(kind); setMsg(null);
    const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) : {};
    setBusy(null);
    if (!res || !res.ok) { setMsg({ ok: false, text: d.error ?? "That did not work." }); return; }
    setMsg({ ok: true, text: ok ?? (d.status ? `Checked: ${String(d.status).replace("_", " ")}${d.detail ? ` (${d.detail})` : ""}` : "Done.") });
    router.refresh();
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AI updates</h1>
        <p className="text-sm text-muted-foreground">New AI capabilities arrive from the platform as signed releases. Digi checks each one before it can run, and you decide when to install it.</p>
      </div>
      {msg && <p role="status" className={msg.ok ? "text-sm text-emerald-700 dark:text-emerald-300" : "text-sm text-destructive"}>{msg.text}</p>}

      <section className="space-y-3 rounded-2xl border bg-card p-5">
        <div className="font-medium">Connection</div>
        {!id.installationId ? (
          <>
            <p className="text-sm text-muted-foreground">Connect this Digi to the platform with the single-use enrollment token you were given.</p>
            <div className="space-y-1.5"><label htmlFor="url" className="text-sm font-medium">Release address</label><Input id="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste the address you were given" aria-describedby="url-hint" />
              {/* there is no fixed release address: it comes with the enrollment token (QA DEF-22) */}
              <p id="url-hint" className="text-xs text-muted-foreground">The https address that came with your enrollment token. If you do not have it, ask whoever gave you the token.</p></div>
            <div className="space-y-1.5"><label htmlFor="tok" className="text-sm font-medium">Enrollment token</label><Input id="tok" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} /></div>
            <Button disabled={!url || !token || busy !== null} onClick={() => act("enroll", "/api/admin/updates/enroll", "POST", { url, token }, "Connected.")}>{busy === "enroll" && <Loader2 className="animate-spin" />} Connect</Button>
          </>
        ) : (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">Connected as <b className="font-mono">{id.installationId}</b>. {id.lastCheckAt ? `Last checked ${campusTime(id.lastCheckAt)}.` : "Not checked yet."}</p>
            {id.lastCheckError && <p role="alert" className="text-destructive">{id.lastCheckError}</p>}
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2">Updates
                <select className="h-9 rounded-md border bg-background px-2" value={id.updateMode} onChange={(e) => act("mode", "/api/admin/updates/settings", "PUT", { mode: e.target.value }, "Saved.")}>
                  <option value="approval">Ask me first (recommended)</option><option value="auto">Install automatically</option><option value="pin">Stay on the current release</option>
                </select>
              </label>
              <label className="flex items-center gap-2">Channel
                <select className="h-9 rounded-md border bg-background px-2" value={id.channel} onChange={(e) => act("channel", "/api/admin/updates/settings", "PUT", { channel: e.target.value }, "Saved.")}>
                  <option value="stable">Stable</option><option value="preview">Preview</option>
                </select>
              </label>
              <Button variant="outline" disabled={busy !== null} onClick={() => act("check", "/api/admin/updates/check", "POST")}>{busy === "check" ? <Loader2 className="animate-spin" /> : <RefreshCw />} Check now</Button>
              <Button variant="outline" disabled={busy !== null || !id.previousRelease} onClick={() => act("rollback", "/api/admin/updates/rollback", "POST", undefined, "Went back to the previous release.")}><Undo2 /> Roll back</Button>
            </div>
            <p className="text-xs text-muted-foreground">Security updates install by themselves after 7 days even if you chose to wait; everything else is never forced.</p>
          </div>
        )}
      </section>

      <section className="rounded-2xl border bg-card">
        <div className="border-b px-5 py-3.5 text-sm font-semibold">Releases</div>
        {v.releases.length === 0 ? <p className="px-5 py-8 text-center text-sm text-muted-foreground">Nothing has arrived yet.</p> : (
          <ul className="divide-y">
            {v.releases.map((r) => (
              <li key={r.releaseId} className="space-y-2 px-5 py-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><b>{r.releaseId}</b> {r.securityCritical && <span className="ml-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs">security</span>}</div>
                  <span className={r.status === "active" ? "font-medium text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"}>{STATUS[r.status] ?? r.status}</span>
                </div>
                <div className="text-muted-foreground">{r.capabilities.map((c) => c.name).join(", ") || "No capabilities"}{r.notes ? ` · ${r.notes}` : ""}</div>
                {r.reason && <div className="text-destructive">{r.reason}</div>}
                {r.status === "pending_approval" && (
                  <div className="flex gap-2">
                    <Button size="sm" disabled={busy !== null} onClick={() => act("ap" + r.releaseId, `/api/admin/updates/${r.releaseId}/approve`, "POST", undefined, `${r.releaseId} installed.`)}>{busy === "ap" + r.releaseId ? <Loader2 className="animate-spin" /> : <Check />} Install</Button>
                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => act("dc" + r.releaseId, `/api/admin/updates/${r.releaseId}/decline`, "POST", { reason: "Declined by an Admin." }, "Declined.")}>Not now</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border bg-card">
        <div className="border-b px-5 py-3.5 text-sm font-semibold">AI capabilities</div>
        <p className="px-5 pt-3 text-xs text-muted-foreground">Choose which Apps each capability appears in here. Which roles may use it is set on the <Link href="/settings/permissions" className="underline underline-offset-4 hover:text-foreground">Permissions</Link> page, where each installed capability is listed under “AI Capabilities”. A capability never gives anyone more access than their own role already has.</p>
        {v.capabilities.length === 0 ? <p className="px-5 py-8 text-center text-sm text-muted-foreground">No capabilities are installed.</p> : (
          <ul className="divide-y">
            {v.capabilities.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm">
                <div><div className="font-medium">{c.name}</div><div className="text-muted-foreground">{c.description}</div></div>
                <div className="flex gap-3">
                  {v.apps.map((a) => (
                    <label key={a.id} className="flex items-center gap-1.5">
                      <input type="checkbox" checked={c.apps[a.id] !== false} onChange={(e) => act("app" + c.id + a.id, "/api/admin/capabilities", "PUT", { capability: c.id, app: a.id, enabled: e.target.checked }, "Saved.")} /> {a.name}
                    </label>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
