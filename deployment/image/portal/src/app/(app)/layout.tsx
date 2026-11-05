import { AppSidebar } from "@/components/app-sidebar";
import { NotificationsBell } from "@/components/notifications-bell";
import { ThemeToggle } from "@/components/theme-toggle";
import { TopNav } from "@/components/top-nav";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { StoreMode } from "@/components/store-mode";
import { getBrand } from "@/lib/brand";
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
    <SidebarProvider className="h-svh flex-col">
      <TopNav brand={brand} permissions={user.permissions}>
        <NotificationsBell items={notifications} userId={user.id} />
        <ThemeToggle />
      </TopNav>
      <div className="flex min-h-0 flex-1">
        <AppSidebar brand={brand} user={user} />
        <SidebarInset className="min-h-0 overflow-hidden">
          <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        </SidebarInset>
      </div>
    </SidebarProvider>
    </StoreMode>
  );
}
