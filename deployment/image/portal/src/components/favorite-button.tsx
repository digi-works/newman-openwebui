"use client";

import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toggleFavorite, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export function FavoriteButton({ agentId, labelled }: { agentId: string; labelled?: boolean }) {
  const { favorites } = useStore();
  const on = favorites.includes(agentId);
  return (
    <Button
      variant={labelled ? "outline" : "ghost"}
      size={labelled ? "default" : "icon-sm"}
      aria-label={on ? "Remove from favorites" : "Add to favorites"}
      aria-pressed={on}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFavorite(agentId); }}
    >
      <Star className={cn(on && "fill-amber-400 text-amber-400")} />
      {labelled && (on ? "Favorited" : "Favorite")}
    </Button>
  );
}
