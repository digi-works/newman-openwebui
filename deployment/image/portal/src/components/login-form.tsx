"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LoginForm({ org, passwordReset = false }: { org: string; passwordReset?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // A rejected sign-in is about the email and password together (the message never says which), so both are marked and point at it (QA DEF-43).
  const [badFields, setBadFields] = useState(false);
  const fieldProps = badFields ? { "aria-invalid": true, "aria-describedby": "login-error" } : {};
  const edited = () => { if (badFields) setBadFields(false); };

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
        setBadFields(res.status < 500);
        setBusy(false);
        return;
      }
      const out = (await res.json().catch(() => ({}))) as { mustChangePassword?: boolean };
      router.replace(out.mustChangePassword ? "/account/password" : "/");
      router.refresh();
    } catch {
      setBadFields(false);
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
          <Input id="email" name="email" type="email" required autoFocus placeholder="you@newmanu.edu" autoComplete="username" onInput={edited} {...fieldProps} className="h-10" />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="text-sm font-medium">Password</label>
            {/* emails a reset link, or says to ask an Admin where the server cannot send email (QA DEF-30) */}
            <Link href="/forgot-password" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">Forgot password?</Link>
          </div>
          <Input id="password" name="password" type="password" required autoComplete="current-password" onInput={edited} {...fieldProps} className="h-10" />
        </div>
        {passwordReset && !error && (
          <p role="status" className="rounded-lg border bg-muted px-3 py-2 text-sm text-muted-foreground">Your password was changed. Sign in with the new one.</p>
        )}
        {error && <p id="login-error" role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <Button type="submit" size="lg" className="h-10 w-full" disabled={busy}>{busy && <Loader2 className="animate-spin" />}{busy ? "Signing in…" : "Sign in"}</Button>
      </div>
    </form>
  );
}
