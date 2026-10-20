import { sq } from "@/lib/studio/db";
import { platformApi } from "@/lib/studio/guard";

/** The platform audit trail, newest first. Platform admins only. */
export async function GET() {
  const g = await platformApi("platform_admin");
  if ("res" in g) return g.res;
  return Response.json({ items: await sq("select id, operator_id, actor, action, entity_type, entity_id, result, metadata, created_at from studio_audit_events order by id desc limit 200") });
}
