import { generateWorkerDraft } from "@/lib/studio/builder";
import { jsonBody, platformApi } from "@/lib/studio/guard";
import { StudioError } from "@/lib/studio/store";

/** Plain English to a Worker DRAFT: { request }. The result is only ever a draft; a human has to review it before it can be published. */
export async function POST(req: Request) {
  const g = await platformApi();
  if ("res" in g) return g.res;
  const b = await jsonBody<{ request?: unknown }>(req);
  if (!b || typeof b.request !== "string") return Response.json({ error: "Describe the Worker." }, { status: 400 });
  try {
    return Response.json(await generateWorkerDraft(g.op, b.request));
  } catch (e) {
    if (e instanceof StudioError) return Response.json({ error: e.message, problems: e.problems }, { status: e.status });
    console.error("worker generation failed", e);
    return Response.json({ error: "The builder failed. Try again." }, { status: 502 });
  }
}
