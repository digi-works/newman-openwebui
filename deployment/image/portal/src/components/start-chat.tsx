"use client";

import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createChat } from "@/lib/store";

/** Opens a new chat with the agent, optionally sending a first prompt. */
export function StartChat({ agentId, prompt, children, variant, size, className }: {
  agentId: string; prompt?: string; children?: React.ReactNode;
  variant?: React.ComponentProps<typeof Button>["variant"]; size?: React.ComponentProps<typeof Button>["size"]; className?: string;
}) {
  const router = useRouter();
  return (
    <Button variant={variant} size={size} className={className} onClick={async () => router.push(`/chat/${await createChat(agentId, prompt)}`)}>
      {children ?? <>Start chat <ArrowRight /></>}
    </Button>
  );
}

export function StarterPrompt({ agentId, prompt }: { agentId: string; prompt: string }) {
  const router = useRouter();
  return (
    <button
      onClick={async () => router.push(`/chat/${await createChat(agentId, prompt)}`)}
      className="flex w-full items-center justify-between gap-3 rounded-lg border bg-card px-3.5 py-2.5 text-left text-sm transition-colors hover:bg-muted"
    >
      <span>{prompt}</span>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}
