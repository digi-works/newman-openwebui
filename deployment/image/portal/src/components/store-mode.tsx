"use client";

import { setStoreScope } from "@/lib/store";

/** Tells the chat cache who is signed in before any child reads it. Idempotent, so safe to run during render. */
export function StoreMode({ scope, children }: { scope: string; children: React.ReactNode }) {
  setStoreScope(scope);
  return <>{children}</>;
}
