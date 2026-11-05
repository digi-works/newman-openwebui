"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { hasPermission, P } from "@/lib/permissions";
import { cn } from "@/lib/utils";

/** The white bar across the top: Newman logo and product name, the main sections as a segmented control, and the page tools on the right. */
export function TopNav({ brand, permissions, children }: { brand: { name: string; org: string }; permissions: string[]; children?: React.ReactNode }) {
  const pathname = usePathname();
  const has = (code: Parameters<typeof hasPermission>[1]) => hasPermission(permissions, code);
  const tabs = [
    { href: "/", label: "Home", active: pathname === "/" || pathname.startsWith("/chat") },
    { href: "/workers", label: "Workers", active: pathname.startsWith("/workers") },
    ...(has(P.bookingsViewOwn) || has(P.bookingsViewAll) ? [{ href: "/bookings", label: "Bookings", active: pathname.startsWith("/bookings") }] : []),
    ...(has(P.approvalsDecide) ? [{ href: "/approvals", label: "Approvals", active: pathname.startsWith("/approvals") }] : []),
    { href: "/history", label: "History", active: pathname === "/history" },
  ];

  return (
    <header className="top-nav relative z-20 flex h-[66px] shrink-0 items-center justify-between gap-4 border-b bg-card px-4 md:px-6">
      <div className="flex min-w-0 items-center gap-3 md:min-w-[260px] md:gap-4">
        <SidebarTrigger className="size-[34px] rounded-[9px] border md:hidden" />
        <Link href="/" className="flex items-center gap-4" aria-label={`${brand.name} home`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- SVG wordmark, no optimisation needed */}
          <img src="/newman-logo-wide.svg" alt={brand.org} className="nav-logo h-[26px] w-auto" />
          <span className="hidden h-[26px] w-px bg-border sm:block" />
          <span className="hidden flex-col gap-px sm:flex">
            <span className="text-[14.5px] font-semibold leading-tight tracking-[-0.01em]">{brand.name}</span>
            <span className="text-[11px] uppercase leading-tight tracking-[0.06em] text-muted-foreground">Campus assistant</span>
          </span>
        </Link>
      </div>

      <nav aria-label="Main" className="hidden gap-0.5 rounded-[10px] bg-background p-[3px] lg:flex dark:bg-[#232323]">
        {tabs.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            aria-current={t.active ? "page" : undefined}
            className={cn(
              "rounded-lg px-5 py-2 text-[13.5px] font-medium tracking-[-0.005em] text-muted-foreground transition-colors hover:text-foreground",
              t.active && "bg-card text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.08)]",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="flex items-center justify-end gap-2 md:min-w-[260px]">{children}</div>
    </header>
  );
}
