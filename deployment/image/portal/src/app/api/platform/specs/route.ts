import { jsonBody, platformApi } from "@/lib/studio/guard";
import { listSpecs, saveSpec, StudioError } from "@/lib/studio/store";

const KINDS = ["tool", "skill", "policy", "model_profile"] as const;
type Kind = (typeof KINDS)[number];

/** Tools, Skills, Policies and Model Profiles. GET ?kind=tool lists them; POST { kind, spec } saves a new version. */
export async function GET(req: Request) {
  const g = await platformApi();
  if ("res" in g) return g.res;
  const kind = new URL(req.url).searchParams.get("kind") as Kind;
  if (!KINDS.includes(kind)) return Response.json({ error: "Choose tool, skill, policy or model_profile." }, { status: 400 });
  return Response.json({ items: await listSpecs(kind) });
}

export async function POST(req: Request) {
  const g = await platformApi();
  if ("res" in g) return g.res;
  const b = await jsonBody<{ kind?: unknown; spec?: unknown }>(req);
  if (!b || !KINDS.includes(b.kind as Kind) || !b.spec || typeof b.spec !== "object") return Response.json({ error: "Send { kind, spec }." }, { status: 400 });
  try {
    return Response.json(await saveSpec(g.op, b.kind as Kind, b.spec as Record<string, unknown>));
  } catch (e) {
    if (e instanceof StudioError) return Response.json({ error: e.message, problems: e.problems }, { status: e.status });
    throw e;
  }
}
