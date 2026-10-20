import { P } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { approveRelease } from "@/lib/stack/installer";

/** Approves a release that passed every check, which installs and activates it. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requirePermission(P.aiManage);
  if (!admin) return Response.json({ error: "You do not have permission to manage AI updates." }, { status: 403 });
  const r = await approveRelease(admin.id, (await ctx.params).id);
  return r.ok ? Response.json({ ok: true }) : Response.json({ error: r.reason }, { status: 409 });
}
