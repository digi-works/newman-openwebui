import { AppSidebar } from "@/components/app-sidebar";
import { NotificationsBell } from "@/components/notifications-bell";
import { ThemeToggle } from "@/components/theme-toggle";
import { TopbarTicker } from "@/components/topbar-ticker";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { StoreMode } from "@/components/store-mode";
import { getBrand } from "@/lib/brand";
import { getFacts } from "@/lib/facts";
import { getNotifications } from "@/lib/notifications";
import { getSessionUser } from "@/lib/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic"; // brand and data source come from runtime env

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const brand = getBrand();
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/account/password");
  const notifications = await getNotifications(user);
  return (
    <StoreMode scope={user.id}>
    <SidebarProvider className="h-svh">
      <AppSidebar brand={brand} user={user} />
      <SidebarInset className="min-h-0 overflow-hidden">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="mx-1 h-4" />
          <TopbarTicker facts={getFacts()} />
          <div className="ml-auto flex items-center gap-1">
            <NotificationsBell items={notifications} userId={user.id} />
            <ThemeToggle />
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </SidebarInset>
    </SidebarProvider>
    </StoreMode>
  );
}
