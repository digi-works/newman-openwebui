import { internalAuthorized } from "@/lib/internal-auth";
import { callTool } from "@/lib/tools/gateway";

/** The one entry point for Open WebUI tool modules (M5.1): POST { chat_id, args }. Open WebUI runs as a shared runtime account, so identity comes only from chat_id. */
export async function POST(req: Request, ctx: { params: Promise<{ name: string }> }) {
  if (!internalAuthorized(req)) return Response.json({ error: "Not found." }, { status: 404 });
  let b: { chat_id?: unknown; args?: unknown };
  try { b = await req.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  const args = b.args && typeof b.args === "object" && !Array.isArray(b.args) ? (b.args as Record<string, unknown>) : {};
  const { name } = await ctx.params;
  const out = await callTool(b.chat_id, name, args, { embeds: req.headers.get("x-want-embed") === "1" });
  return Response.json(out.body, { status: out.status });
}
