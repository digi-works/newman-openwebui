import Link from "next/link";
import { redirect } from "next/navigation";
import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { getBrand } from "@/lib/brand";
import { mailConfigured } from "@/lib/mail";
import { LINK_MINUTES } from "@/lib/password-reset";
import { authLive, getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Forgot password (QA DEF-30). Without email set up on the server, recovery is an Admin's Reset password, and this page says how to ask. */
export default async function ForgotPasswordPage() {
  if (await getSessionUser()) redirect("/");
  const brand = getBrand();
  return (
    <div className="grid min-h-svh place-items-center bg-muted/30 p-6">
      <div className="w-full max-w-md rounded-2xl border bg-background p-8 shadow-sm">
        {authLive() && mailConfigured() ? (
          <ForgotPasswordForm org={brand.org} minutes={LINK_MINUTES} />
        ) : (
          <div className="space-y-5">
            <div className="space-y-1.5">
              <h1 className="text-2xl font-semibold tracking-tight">Forgot password</h1>
              <p className="text-sm text-muted-foreground">
                Ask an Admin at {brand.org} to reset it under Settings &gt; Users. They will give you a temporary password, and you choose a new one when you sign in. If no Admin can sign in, your IT team can reset it on the server.
              </p>
            </div>
            <Link href="/login" className="block text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">Back to sign in</Link>
          </div>
        )}
      </div>
    </div>
  );
}
