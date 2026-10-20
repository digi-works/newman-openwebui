"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Brain, CalendarDays, ChevronsUpDown, CircleHelp, Download, History, House, KeyRound, LogOut, Mail, MessageSquare, Plus, Settings, ShieldCheck, Sparkles, UserRound, Users, UsersRound } from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem, SidebarRail,
} from "@/components/ui/sidebar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { createChat, useStore, visibleChats } from "@/lib/store";
import type { Brand } from "@/lib/brand";
import { hasPermission, P } from "@/lib/permissions";
import type { SessionUser } from "@/lib/session";

export function AppSidebar({ brand, user }: { brand: Brand; user: SessionUser }) {
  const pathname = usePathname();
  const router = useRouter();
  const { chats } = useStore();
  const recent = visibleChats(chats).slice(0, 5);
  const inSettings = pathname.startsWith("/settings");
  const has = (code: Parameters<typeof hasPermission>[1]) => hasPermission(user.permissions, code);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/" />}>
              <Image src="/digiworks-mark.png" alt="" width={32} height={32} className="size-8 shrink-0" />
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate font-semibold">{brand.name}</span>
                <span className="truncate text-xs text-muted-foreground">{brand.org}</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Platform</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Home" isActive={pathname === "/"} render={<Link href="/" />}>
                <House /> <span>Home</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Workers" isActive={pathname.startsWith("/workers")} render={<Link href="/workers" />}>
                <Users /> <span>Workers</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {(has(P.bookingsViewOwn) || has(P.bookingsViewAll)) && (
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Bookings" isActive={pathname.startsWith("/bookings")} render={<Link href="/bookings" />}>
                  <CalendarDays /> <span>Bookings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
            {has(P.approvalsDecide) && (
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Approvals" isActive={pathname.startsWith("/approvals")} render={<Link href="/approvals" />}>
                  <ShieldCheck /> <span>Approvals</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="History" isActive={pathname === "/history"} render={<Link href="/history" />}>
                <History /> <span>History</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel>Recent chats</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={async () => router.push(`/chat/${await createChat("digi")}`)}>
                <Plus /> <span>New chat</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {recent.map((c) => (
              <SidebarMenuItem key={c.id}>
                <SidebarMenuButton isActive={pathname === `/chat/${c.id}`} render={<Link href={`/chat/${c.id}`} />}>
                  <MessageSquare /> <span className="truncate">{c.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>

        {/* Settings sits at the bottom, above Help and the account menu */}
        <SidebarGroup className="mt-auto">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Settings" isActive={inSettings} render={<Link href="/settings" />}>
                <Settings /> <span>Settings</span>
              </SidebarMenuButton>
              {inSettings && (
                <SidebarMenuSub>
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton isActive={pathname.startsWith("/settings/account")} render={<Link href="/settings/account" />}>
                      <UserRound /> <span>Account</span>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                  {has(P.usersView) && (
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton isActive={pathname.startsWith("/settings/users")} render={<Link href="/settings/users" />}>
                        <UsersRound /> <span>Users</span>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  )}
                  {has(P.chatUse) && (
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton isActive={pathname.startsWith("/settings/memory")} render={<Link href="/settings/memory" />}>
                        <Brain /> <span>Memory</span>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  )}
                  {has(P.bookingsApprove) && (
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton isActive={pathname.startsWith("/settings/notifications")} render={<Link href="/settings/notifications" />}>
                        <Mail /> <span>Notifications</span>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  )}
                  {has(P.aiManage) && (
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton isActive={pathname.startsWith("/settings/updates")} render={<Link href="/settings/updates" />}>
                        <Download /> <span>AI updates</span>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  )}
                  {has(P.aiManage) && (
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton isActive={pathname.startsWith("/settings/ai")} render={<Link href="/settings/ai" />}>
                        <Sparkles /> <span>AI connection</span>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  )}
                  {has(P.rolesManage) && (
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton isActive={pathname.startsWith("/settings/permissions")} render={<Link href="/settings/permissions" />}>
                        <KeyRound /> <span>Permissions</span>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  )}
                </SidebarMenuSub>
              )}
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Help" onClick={async () => router.push(`/chat/${await createChat("digi", "What can you help me with in Ask Digi?")}`)}>
              <CircleHelp /> <span>Help</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger render={<SidebarMenuButton size="lg" />}>
                <Avatar className="size-8"><AvatarFallback>{user.initials}</AvatarFallback></Avatar>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-medium">{user.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                </div>
                <ChevronsUpDown className="ml-auto size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="min-w-52">
                <DropdownMenuItem onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); router.refresh(); }}>
                  <LogOut /> Sign out
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled>Powered by Digiworks</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
