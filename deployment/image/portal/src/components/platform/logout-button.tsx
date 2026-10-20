"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function LogoutButton() {
  const router = useRouter();
  return <Button size="sm" variant="outline" onClick={async () => { await fetch("/api/platform/auth/logout", { method: "POST" }); router.replace("/platform/login"); router.refresh(); }}>Sign out</Button>;
}
