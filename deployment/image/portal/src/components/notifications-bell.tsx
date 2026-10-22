"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Bell, BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Notification } from "@/lib/notifications";
import { cn } from "@/lib/utils";

const EVT = "dw-notif-read";

/** Bell with a dropdown. "Read" is remembered per user in this browser, keyed by notification id. */
export function NotificationsBell({ items, userId }: { items: Notification[]; userId: string }) {
  const key = `dw-notif-read-${userId}`;
  const raw = useSyncExternalStore(
    (cb) => { window.addEventListener("storage", cb); window.addEventListener(EVT, cb); return () => { window.removeEventListener("storage", cb); window.removeEventListener(EVT, cb); }; },
    () => { try { return localStorage.getItem(key) ?? "[]"; } catch { return "[]"; } },
    () => "[]",
  );
  const read: string[] = (() => { try { return JSON.parse(raw); } catch { return []; } })();

  const isRead = (n: Notification) => n.read === true || read.includes(n.id);
  const unread = items.filter((n) => !isRead(n));
  const markAll = () => {
    const next = Array.from(new Set([...read, ...items.map((n) => n.id)]));
    try { localStorage.setItem(key, JSON.stringify(next)); } catch {}
    window.dispatchEvent(new Event(EVT));
    void fetch("/api/notifications/read", { method: "POST" }).catch(() => undefined); // decisions are kept as read on the server too
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="relative" aria-label={unread.length ? `${unread.length} unread notification${unread.length === 1 ? "" : "s"}` : "Notifications"} />}>
        {unread.length ? <BellRing className="size-4" /> : <Bell className="size-4" />}
        {unread.length > 0 && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-[oklch(0.5_0.17_22)] ring-2 ring-background" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-semibold">Notifications</span>
          {unread.length > 0 && <button onClick={markAll} className="text-xs font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground">Mark all as read</button>}
        </div>
        {items.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">You’re all caught up.</div>
        ) : (
          // each row is a menu item: arrow keys move between them, and choosing one closes the panel (QA DEF-57)
          <div className="max-h-80 overflow-auto">
            {items.map((n) => (
              <DropdownMenuItem
                key={n.id} onClick={markAll} render={<Link href={n.href} />}
                className={cn("flex-col items-start gap-0.5 rounded-none border-b px-4 py-3 last:border-0 hover:bg-muted", !isRead(n) && "bg-accent/40")}
              >
                <span className="block text-sm font-medium">{n.title}</span>
                <span className="block text-xs text-muted-foreground">{n.body}</span>
              </DropdownMenuItem>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
