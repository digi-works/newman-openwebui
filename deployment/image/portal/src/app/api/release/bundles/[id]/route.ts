import { authenticateInstallation } from "@/lib/studio/installations";
import { getBundle } from "@/lib/studio/releases";

/** The signed bundle itself. A revoked release is no longer served. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const who = await authenticateInstallation(req, new URL(req.url).pathname);
  if (!who) return Response.json({ error: "Not authorised." }, { status: 401 });
  const bundle = await getBundle((await ctx.params).id);
  return bundle ? Response.json(bundle) : Response.json({ error: "Not found." }, { status: 404 });
}
