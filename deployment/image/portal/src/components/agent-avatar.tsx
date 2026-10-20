import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { hueOf } from "@/lib/hue";
import { cn } from "@/lib/utils";

export function AgentAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <Avatar className={cn("size-9", className)}>
      <AvatarFallback className="hue-tint border font-semibold" style={{ "--h": hueOf(name) } as React.CSSProperties}>{name.charAt(0)}</AvatarFallback>
    </Avatar>
  );
}
