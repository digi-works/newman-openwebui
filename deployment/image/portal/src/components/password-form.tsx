"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PasswordForm({ forced, org }: { forced: boolean; org: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get("next") !== f.get("confirm")) { setError("The new passwords do not match."); return; }
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current: f.get("current"), next: f.get("next") }),
    }).catch(() => null);
    if (!res || !res.ok) {
      setError(res ? ((await res.json().catch(() => ({}))).error ?? "Could not change the password.") : "Can’t reach the portal. Try again.");
      setBusy(false);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold tracking-tight">{forced ? "Choose a new password" : "Change password"}</h1>
        <p className="text-sm text-muted-foreground">
          {forced ? `Your ${org} account was set up with a temporary password. Choose your own to continue.` : "Other devices will be signed out."}
        </p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="current" className="text-sm font-medium">Current password</label>
        <Input id="current" name="current" type="password" required autoComplete="current-password" className="h-10" />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="next" className="text-sm font-medium">New password</label>
        <Input id="next" name="next" type="password" required minLength={12} autoComplete="new-password" className="h-10" />
        <p className="text-xs text-muted-foreground">At least 12 characters. Do not use your email name.</p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="confirm" className="text-sm font-medium">Confirm new password</label>
        <Input id="confirm" name="confirm" type="password" required autoComplete="new-password" className="h-10" />
      </div>
      {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      <Button type="submit" size="lg" className="h-10 w-full" disabled={busy}>{busy && <Loader2 className="animate-spin" />}{busy ? "Saving…" : "Save password"}</Button>
    </form>
  );
}
