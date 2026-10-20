import { P } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { StackError } from "@/lib/stack/identity";
import { rejectRelease } from "@/lib/stack/installer";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requirePermission(P.aiManage);
  if (!admin) return Response.json({ error: "You do not have permission to manage AI updates." }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { reason?: unknown };
  try {
    await rejectRelease((await ctx.params).id, typeof b.reason === "string" ? b.reason : "");
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof StackError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
