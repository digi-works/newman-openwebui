"use client";

import Link from "next/link";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Asks for a reset link (QA DEF-30). Says the same thing whether or not the address has an account. */
export function ForgotPasswordForm({ org, minutes }: { org: string; minutes: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email") ?? "").trim();
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/forgot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) {
      setError(res ? ((await res.json().catch(() => ({}))).error ?? "Could not send the link. Try again.") : "Can’t reach the portal. Check your connection and try again.");
      return;
    }
    setSentTo(email);
  }

  if (sentTo) {
    return (
      <div className="space-y-5">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
          <p role="status" className="text-sm text-muted-foreground">
            If <span className="font-medium text-foreground">{sentTo}</span> has a Digi account, we have emailed it a link to choose a new password. The link works once, for {minutes} minutes. Nothing there? Check your junk folder, or ask an Admin at {org} to reset it under Settings &gt; Users.
          </p>
        </div>
        <Link href="/login" className="block text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">Back to sign in</Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Forgot password</h1>
        <p className="text-sm text-muted-foreground">Enter the email of your {org} account and we will email you a link to choose a new password.</p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm font-medium">Email</label>
        <Input id="email" name="email" type="email" required autoFocus placeholder="you@newmanu.edu" autoComplete="username" className="h-10" />
      </div>
      {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      <Button type="submit" size="lg" className="h-10 w-full" disabled={busy}>{busy && <Loader2 className="animate-spin" />}{busy ? "Sending…" : "Email me a link"}</Button>
      <Link href="/login" className="block text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">Back to sign in</Link>
    </form>
  );
}
