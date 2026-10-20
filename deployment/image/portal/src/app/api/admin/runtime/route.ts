import { P } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { runtimeView, switchRuntime } from "@/lib/stack/runtime-switch";

/** Which AI runtime this stack uses, and whether each is healthy and able to run what is installed. */
export async function GET() {
  const admin = await requirePermission(P.aiManage);
  if (!admin) return Response.json({ error: "You do not have permission to manage the AI runtime." }, { status: 403 });
  return Response.json(await runtimeView());
}

/** Switches runtime: { runtime: "owui" | "strands" }. Refused (and nothing changes) unless the target is healthy, supports what is installed and answers a test turn. */
export async function PUT(req: Request) {
  const admin = await requirePermission(P.aiManage);
  if (!admin) return Response.json({ error: "You do not have permission to manage the AI runtime." }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { runtime?: unknown };
  if (b.runtime !== "owui" && b.runtime !== "strands") return Response.json({ error: "Choose owui or strands." }, { status: 400 });
  const r = await switchRuntime(admin, b.runtime);
  return r.ok ? Response.json(r) : Response.json({ error: r.reason, problems: r.problems }, { status: 409 });
}
