import Link from "next/link";
import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/platform/logout-button";
import { currentOperator } from "@/lib/studio/auth";

export const dynamic = "force-dynamic";

/** The Studio console. Reachable only with a platform session that has passed the second factor. */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const op = await currentOperator();
  if (!op || !op.mfaVerified) redirect("/platform/login");
  const nav = [["/platform", "Workers"], ["/platform/tools", "Catalogue"], ["/platform/releases", "Releases"], ["/platform/installations", "Installations"], ...(op.role === "platform_admin" ? [["/platform/audit", "Audit"]] : [])];
  return (
    <div className="min-h-screen">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 md:px-8">
        <div className="flex items-center gap-6">
          <span className="font-semibold">Digi Studio</span>
          <nav className="flex gap-4 text-sm">{nav.map(([href, label]) => <Link key={href} href={href} className="text-muted-foreground hover:text-foreground">{label}</Link>)}</nav>
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">{op.name} · {op.role === "platform_admin" ? "platform admin" : "operator"} <LogoutButton /></div>
      </header>
      <main className="mx-auto w-full max-w-5xl p-4 md:p-8">{children}</main>
    </div>
  );
}
