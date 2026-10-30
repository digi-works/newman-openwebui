"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Sets a new password from a reset link (QA DEF-30), then sends the person to sign in with it. */
export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // as on Change password, the browser knows when the two passwords differ (QA DEF-40)
  const [mismatch, setMismatch] = useState(false);
  const nextRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  function checkMatch() {
    const c = confirmRef.current;
    if (!c) return;
    const bad = c.value !== "" && c.value !== nextRef.current?.value;
    c.setCustomValidity(bad ? "The new passwords do not match." : "");
    setMismatch(bad);
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get("next") !== f.get("confirm")) { setError("The new passwords do not match."); return; }
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, next: f.get("next") }) }).catch(() => null);
    if (!res || !res.ok) {
      setError(res ? ((await res.json().catch(() => ({}))).error ?? "Could not change the password.") : "Can’t reach the portal. Try again.");
      setBusy(false);
      return;
    }
    router.replace("/login?reset=1");
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
        <p className="text-sm text-muted-foreground">You will be signed out everywhere and can then sign in with the new password.</p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="next" className="text-sm font-medium">New password</label>
        <Input ref={nextRef} id="next" name="next" type="password" required autoFocus minLength={12} autoComplete="new-password" aria-describedby="next-hint" onInput={checkMatch} className="h-10" />
        <p id="next-hint" className="text-xs text-muted-foreground">At least 12 characters. Do not include the first part of your email address (before the @).</p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="confirm" className="text-sm font-medium">Confirm new password</label>
        <Input ref={confirmRef} id="confirm" name="confirm" type="password" required minLength={12} autoComplete="new-password" aria-invalid={mismatch || undefined} aria-describedby={mismatch ? "confirm-error" : undefined} onInput={checkMatch} className="h-10" />
        {mismatch && <p id="confirm-error" className="text-xs text-destructive">The new passwords do not match.</p>}
      </div>
      {error && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}{error.includes("new one") && <> <Link href="/forgot-password" className="font-medium underline underline-offset-4">Ask for a new link</Link></>}
        </p>
      )}
      <Button type="submit" size="lg" className="h-10 w-full" disabled={busy}>{busy && <Loader2 className="animate-spin" />}{busy ? "Saving…" : "Save password"}</Button>
    </form>
  );
}
