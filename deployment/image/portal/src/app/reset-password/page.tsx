import Link from "next/link";
import { ResetPasswordForm } from "@/components/reset-password-form";

export const dynamic = "force-dynamic";

/** Opened from a reset email (QA DEF-30). The token is checked when the new password is saved, so an old link says so then. */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  return (
    <div className="grid min-h-svh place-items-center bg-muted/30 p-6">
      <div className="w-full max-w-md rounded-2xl border bg-background p-8 shadow-sm">
        {typeof token === "string" && token ? (
          <ResetPasswordForm token={token} />
        ) : (
          <div className="space-y-5">
            <div className="space-y-1.5">
              <h1 className="text-2xl font-semibold tracking-tight">Reset password</h1>
              <p className="text-sm text-muted-foreground">Open this page from the link in your password reset email. To get one, ask for it on the Forgot password page.</p>
            </div>
            <Link href="/forgot-password" className="block text-center text-sm font-medium underline-offset-4 hover:underline">Forgot password</Link>
          </div>
        )}
      </div>
    </div>
  );
}
