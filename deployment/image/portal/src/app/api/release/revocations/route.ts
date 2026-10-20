import { authenticateInstallation } from "@/lib/studio/installations";
import { currentRevocationList } from "@/lib/studio/releases";

/** The signed list of revoked releases and keys. */
export async function GET(req: Request) {
  const who = await authenticateInstallation(req, new URL(req.url).pathname);
  if (!who) return Response.json({ error: "Not authorised." }, { status: 401 });
  return Response.json(await currentRevocationList());
}
