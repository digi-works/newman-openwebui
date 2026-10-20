import { ApprovalError, listPending } from "@/lib/approvals";
import { getSessionUser } from "@/lib/session";

/** Actions waiting for another person's decision. Needs the approvals.decide permission. */
export async function GET() {
  const user = await getSessionUser();
  if (!user || user.mustChangePassword) return Response.json({ error: "Please sign in again." }, { status: 401 });
  try {
    return Response.json({ items: await listPending(user) });
  } catch (e) {
    if (e instanceof ApprovalError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
