import { redirect } from "next/navigation";
import { PasswordForm } from "@/components/password-form";
import { getBrand } from "@/lib/brand";
import { authLive, getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const brand = getBrand();
  return (
    <div className="p-4 md:p-8">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
          <p className="text-sm text-muted-foreground">Your sign-in details at {brand.org}.</p>
        </div>
        <dl className="grid grid-cols-[7rem_1fr] gap-y-2 rounded-xl border bg-card p-4 text-sm">
          <dt className="text-muted-foreground">Name</dt><dd className="font-medium">{user.name}</dd>
          <dt className="text-muted-foreground">Email</dt><dd>{user.email}</dd>
          <dt className="text-muted-foreground">{user.roles.length > 1 ? "Roles" : "Role"}</dt><dd>{user.roles.join(", ") || "No role"}</dd>
        </dl>
        {authLive() ? (
          <div className="rounded-xl border bg-card p-6"><PasswordForm forced={false} org={brand.org} /></div>
        ) : (
          <p className="text-sm text-muted-foreground">Password changes are not available in demo mode.</p>
        )}
      </div>
    </div>
  );
}
