import { jsonBody, platformApi } from "@/lib/studio/guard";
import { getVersions, previewAuthority, reviewsFor, saveDraft, StudioError } from "@/lib/studio/store";

/** One Worker: its versions, the authority preview of the newest one, and its reviews. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await platformApi();
  if ("res" in g) return g.res;
  const { id } = await ctx.params;
  const versions = await getVersions(id);
  if (!versions.length) return Response.json({ error: "Not found." }, { status: 404 });
  let authority: unknown = null, problems: string[] | undefined;
  try { authority = await previewAuthority(versions[0]!.spec); } catch (e) { if (e instanceof StudioError) problems = e.problems ?? [e.message]; else throw e; }
  return Response.json({ versions, authority, problems, reviews: await reviewsFor(id, versions[0]!.version) });
}

/** Edits the Worker's draft: { spec } (the spec's id must be this Worker). */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await platformApi();
  if ("res" in g) return g.res;
  const { id } = await ctx.params;
  const b = await jsonBody<{ spec?: unknown }>(req);
  if (!b?.spec || typeof b.spec !== "object" || (b.spec as { id?: unknown }).id !== id) return Response.json({ error: "Send { spec } with this Worker's id." }, { status: 400 });
  try {
    return Response.json(await saveDraft(g.op, b.spec as Record<string, unknown>, "manual"));
  } catch (e) {
    if (e instanceof StudioError) return Response.json({ error: e.message, problems: e.problems }, { status: e.status });
    throw e;
  }
}
