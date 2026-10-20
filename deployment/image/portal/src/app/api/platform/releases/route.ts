import { jsonBody, platformApi } from "@/lib/studio/guard";
import { createRelease, listReleases } from "@/lib/studio/releases";
import { signerAvailable } from "@/lib/studio/signer";
import { StudioError } from "@/lib/studio/store";

export async function GET() {
  const g = await platformApi();
  return "res" in g ? g.res : Response.json({ items: await listReleases(), signerReady: signerAvailable() });
}

/** Signs a release from published Worker versions. Platform admins only: { workers: [{worker_id, version}], channel, notes?, securityCritical? }. */
export async function POST(req: Request) {
  const g = await platformApi("platform_admin");
  if ("res" in g) return g.res;
  const b = await jsonBody<{ workers?: unknown; channel?: unknown; notes?: unknown; securityCritical?: unknown }>(req);
  const workers = Array.isArray(b?.workers) ? (b!.workers as { worker_id?: unknown; version?: unknown }[]) : [];
  if (!b || !workers.length || workers.some((w) => typeof w.worker_id !== "string" || !Number.isInteger(w.version)) || (b.channel !== "stable" && b.channel !== "preview")) {
    return Response.json({ error: "Send { workers: [{ worker_id, version }], channel: stable | preview }." }, { status: 400 });
  }
  try {
    return Response.json(await createRelease(g.op, {
      workers: workers.map((w) => ({ worker_id: w.worker_id as string, version: w.version as number })), channel: b.channel,
      notes: typeof b.notes === "string" ? b.notes : "", securityCritical: b.securityCritical === true,
    }));
  } catch (e) {
    if (e instanceof StudioError) return Response.json({ error: e.message, problems: e.problems }, { status: e.status });
    console.error("creating a release failed", e);
    return Response.json({ error: (e as Error).message || "Could not create the release." }, { status: 500 });
  }
}
