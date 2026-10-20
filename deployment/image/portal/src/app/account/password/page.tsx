import { redirect } from "next/navigation";
import { PasswordForm } from "@/components/password-form";
import { getBrand } from "@/lib/brand";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function PasswordPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const brand = getBrand();
  return (
    <div className="grid min-h-svh place-items-center bg-muted/30 p-6">
      <div className="w-full max-w-md rounded-2xl border bg-background p-8 shadow-sm">
        <PasswordForm forced={user.mustChangePassword} org={brand.org} />
      </div>
    </div>
  );
}
