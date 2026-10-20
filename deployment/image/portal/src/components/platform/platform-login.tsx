"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Operator sign-in for Digi Studio: password, then a two-factor code. A password alone never opens Studio. */
export function PlatformLogin({ stage: initial }: { stage: "password" | "enroll" | "verify" }) {
  const router = useRouter();
  const [stage, setStage] = useState(initial);
  const [secret, setSecret] = useState<{ secret: string; uri: string; qr?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function post(path: string, body: unknown) {
    setBusy(true); setError("");
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res || !res.ok) { setError(d.error ?? "That did not work."); return null; }
    return d;
  }

  async function password(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const d = await post("/api/platform/auth/login", { email: f.get("email"), password: f.get("password") });
    if (d?.next === "done") { router.replace("/platform"); router.refresh(); return; }
    if (d) setStage(d.next);
  }
  async function code(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = await post("/api/platform/auth/mfa", { code: new FormData(e.currentTarget).get("code") });
    if (d) { router.replace("/platform"); router.refresh(); }
  }
  // fetch the set-up key once when the enrolment step is shown (never during render)
  useEffect(() => {
    if (stage !== "enroll") return;
    void fetch("/api/platform/auth/mfa").then((r) => (r.ok ? r.json() : null)).then((d) => d && setSecret(d)).catch(() => undefined);
  }, [stage]);

  return (
    <main className="grid min-h-screen place-items-center bg-muted/30 p-4">
      <div className="w-full max-w-sm space-y-5 rounded-2xl border bg-card p-6 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold">Digi Studio</h1>
          <p className="text-sm text-muted-foreground">Platform operators only.</p>
        </div>
        {stage === "password" ? (
          <form onSubmit={password} className="space-y-3">
            <div className="space-y-1.5"><label htmlFor="email" className="text-sm font-medium">Email</label><Input id="email" name="email" type="email" required autoComplete="username" /></div>
            <div className="space-y-1.5"><label htmlFor="pw" className="text-sm font-medium">Password</label><Input id="pw" name="password" type="password" required autoComplete="current-password" /></div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>{busy && <Loader2 className="animate-spin" />} Continue</Button>
          </form>
        ) : (
          <form onSubmit={code} className="space-y-3">
            {stage === "enroll" && (
              <div className="space-y-2 rounded-lg border bg-muted/40 p-3 text-sm">
                <p>Set up two-factor sign-in with an authenticator app on your phone (Microsoft Authenticator, Google Authenticator, 1Password and similar). Scan this code, then enter the 6-digit code the app shows.</p>
                {secret?.qr && <div className="mx-auto w-48 rounded bg-white p-1" dangerouslySetInnerHTML={{ __html: secret.qr }} />}
                <p className="text-xs text-muted-foreground">Cannot scan? Add it by hand as a time-based key:</p>
                <p className="break-all font-mono text-xs">{secret?.secret ?? "…"}</p>
              </div>
            )}
            <div className="space-y-1.5"><label htmlFor="code" className="text-sm font-medium">6-digit code</label><Input id="code" name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoComplete="one-time-code" /></div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>{busy && <Loader2 className="animate-spin" />} {stage === "enroll" ? "Finish set-up" : "Sign in"}</Button>
          </form>
        )}
      </div>
    </main>
  );
}
