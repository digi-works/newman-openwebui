import { authenticateInstallation } from "@/lib/studio/installations";
import { latestRelease } from "@/lib/studio/releases";

/** The newest release for a channel (stable or preview). Needs a signed client assertion; an unknown or revoked installation gets nothing. */
export async function GET(req: Request, ctx: { params: Promise<{ channel: string }> }) {
  const { channel } = await ctx.params;
  const who = await authenticateInstallation(req, new URL(req.url).pathname);
  if (!who) return Response.json({ error: "Not authorised." }, { status: 401 });
  if (channel !== "stable" && channel !== "preview") return Response.json({ error: "Unknown channel." }, { status: 404 });
  const r = await latestRelease(channel);
  if (!r) return Response.json({ none: true });
  return Response.json({ release_id: r.release_id, seq: r.seq, security_critical: r.security_critical, signed_at: r.signed_at, digest: r.digest, notes: r.notes, manifest: r.manifest, download: `/api/release/bundles/${r.release_id}` });
}
