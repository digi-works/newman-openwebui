"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LoginForm({ org }: { org: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Digi cannot send email, so recovery is an Admin's Reset password (QA DEF-30); this says how to ask for it.
  const [forgot, setForgot] = useState(false);

  async function signIn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: f.get("email"), password: f.get("password") }),
      });
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).error ?? "Sign-in failed. Try again.");
        setBusy(false);
        return;
      }
      const out = (await res.json().catch(() => ({}))) as { mustChangePassword?: boolean };
      router.replace(out.mustChangePassword ? "/account/password" : "/");
      router.refresh();
    } catch {
      setError("Can’t reach the portal. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={signIn} className="w-full space-y-6">
      <div className="space-y-1.5">
        <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
        <p className="text-sm text-muted-foreground">Use your {org} account to continue</p>
      </div>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="email" className="text-sm font-medium">Email</label>
          <Input id="email" name="email" type="email" required autoFocus placeholder="you@newmanu.edu" autoComplete="username" className="h-10" />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="text-sm font-medium">Password</label>
            <button type="button" aria-expanded={forgot} onClick={() => setForgot((v) => !v)} className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">Forgot password?</button>
          </div>
          <Input id="password" name="password" type="password" required autoComplete="current-password" className="h-10" />
        </div>
        {forgot && (
          <p role="status" className="rounded-lg border bg-muted px-3 py-2 text-sm text-muted-foreground">
            Ask an Admin at {org} to reset it under Settings &gt; Users. They will give you a temporary password, and you choose a new one when you sign in. If no Admin can sign in, your IT team can reset it on the server.
          </p>
        )}
        {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <Button type="submit" size="lg" className="h-10 w-full" disabled={busy}>{busy && <Loader2 className="animate-spin" />}{busy ? "Signing in…" : "Sign in"}</Button>
      </div>
    </form>
  );
}
