import { createEnrollmentToken, listTokens } from "@/lib/studio/installations";
import { jsonBody, platformApi } from "@/lib/studio/guard";
import { StudioError } from "@/lib/studio/store";

export async function GET() {
  const g = await platformApi("platform_admin");
  return "res" in g ? g.res : Response.json({ items: await listTokens() });
}

/** Mints a single-use, expiring enrollment token for a customer stack: { label, hours? }. The token is shown once and never stored in the clear. */
export async function POST(req: Request) {
  const g = await platformApi("platform_admin");
  if ("res" in g) return g.res;
  const b = await jsonBody<{ label?: unknown; hours?: unknown }>(req);
  if (!b || typeof b.label !== "string") return Response.json({ error: "Give the customer a label." }, { status: 400 });
  try {
    return Response.json(await createEnrollmentToken(g.op, b.label, typeof b.hours === "number" ? b.hours : 24));
  } catch (e) {
    if (e instanceof StudioError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
