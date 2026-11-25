import Link from "next/link";
import type { Run } from "@/lib/course-scheduling";
import { cn } from "@/lib/utils";

/** The timetables to choose from (drafts and the one as run), as links that keep the rest of the page's choices. */
export function RunPicker({ runs, run, href }: { runs: Run[]; run: Run; href: (id: number) => string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {runs.map((r) => (
        <Link key={r.id} href={href(r.id)}
          className={cn("rounded-lg border px-3 py-1.5 text-sm", r.id === run.id ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}>
          {r.label}
        </Link>
      ))}
    </div>
  );
}
