import { jsonBody, platformApi } from "@/lib/studio/guard";
import { listWorkers, saveDraft, StudioError } from "@/lib/studio/store";

export async function GET() {
  const g = await platformApi();
  return "res" in g ? g.res : Response.json({ items: await listWorkers() });
}

/** Saves a Worker draft from a spec the operator wrote: { spec }. */
export async function POST(req: Request) {
  const g = await platformApi();
  if ("res" in g) return g.res;
  const b = await jsonBody<{ spec?: unknown }>(req);
  if (!b?.spec || typeof b.spec !== "object") return Response.json({ error: "Send { spec }." }, { status: 400 });
  try {
    return Response.json(await saveDraft(g.op, b.spec as Record<string, unknown>, "manual"));
  } catch (e) {
    if (e instanceof StudioError) return Response.json({ error: e.message, problems: e.problems }, { status: e.status });
    throw e;
  }
}
