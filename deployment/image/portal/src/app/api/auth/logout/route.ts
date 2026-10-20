import { cookies } from "next/headers";
import { auditEvent } from "@/lib/audit";
import { withTenant } from "@/lib/digi-db";
import { authLive, COOKIE, destroySession, getSessionToken, getSessionUser } from "@/lib/session";
import { getTenant } from "@/lib/tenant";

export async function POST() {
  if (authLive()) {
    try {
      const [token, tenant, user] = await Promise.all([getSessionToken(), getTenant(), getSessionUser()]);
      if (token && tenant) {
        await destroySession(tenant.id, token);
        if (user) await withTenant(tenant.id, (c) => auditEvent(c, { tenantId: tenant.id, userId: user.id, action: "auth.logout" }));
      }
    } catch (e) {
      console.error("logout failed", e);
    }
  }
  (await cookies()).delete(COOKIE);
  return Response.json({ ok: true });
}
