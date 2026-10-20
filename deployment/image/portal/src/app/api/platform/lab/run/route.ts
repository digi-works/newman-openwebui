import { jsonBody, platformApi } from "@/lib/studio/guard";
import { PERSONAS, runPersona, type PersonaKey } from "@/lib/studio/lab";
import { StudioError } from "@/lib/studio/store";

/** Runs a Worker draft as a persona on the platform test stack: { workerId, version?, persona, prompt }. Returns the answer and a trace of tools and Authority decisions. */
export async function POST(req: Request) {
  const g = await platformApi();
  if ("res" in g) return g.res;
  const b = await jsonBody<{ workerId?: unknown; version?: unknown; persona?: unknown; prompt?: unknown }>(req);
  if (!b || typeof b.workerId !== "string" || typeof b.prompt !== "string" || !PERSONAS.some((p) => p.key === b.persona)) return Response.json({ error: "Send { workerId, persona, prompt }." }, { status: 400 });
  try {
    return Response.json(await runPersona(g.op, { workerId: b.workerId, version: Number.isInteger(b.version) ? (b.version as number) : undefined, persona: b.persona as PersonaKey, prompt: b.prompt }));
  } catch (e) {
    if (e instanceof StudioError) return Response.json({ error: e.message, problems: e.problems }, { status: e.status });
    console.error("lab run failed", e);
    return Response.json({ error: (e as Error).message || "The test run failed." }, { status: 502 });
  }
}
