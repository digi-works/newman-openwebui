/**
 * The methods each API route answers, so a method a route does not take gets 405 with an Allow header (QA DEF-45). Next.js answers that
 * case itself with an empty 405 and no Allow, and an unknown method such as TRACE with a 500. test/api-methods.test.mts fails when this
 * list and the route files disagree; it prints the line to add or change.
 */
export const API_METHODS: Record<string, string[]> = {
  "/api/actions/[id]/cancel": ["POST"],
  "/api/actions/[id]/confirm": ["POST"],
  "/api/admin/ai": ["GET", "PUT"],
  "/api/admin/ai/apply": ["POST"],
  "/api/admin/ai/test": ["POST"],
  "/api/admin/capabilities": ["PUT"],
  "/api/admin/mcp": ["GET", "POST"],
  "/api/admin/mcp/[id]": ["DELETE", "PATCH"],
  "/api/admin/memory": ["GET", "PUT"],
  "/api/admin/notifications": ["GET", "POST", "PUT"],
  "/api/admin/roles": ["GET", "POST"],
  "/api/admin/roles/[id]": ["DELETE", "PUT"],
  "/api/admin/runtime": ["GET", "PUT"],
  "/api/admin/updates": ["GET"],
  "/api/admin/updates/[id]/approve": ["POST"],
  "/api/admin/updates/[id]/decline": ["POST"],
  "/api/admin/updates/check": ["POST"],
  "/api/admin/updates/enroll": ["POST"],
  "/api/admin/updates/rollback": ["POST"],
  "/api/admin/updates/settings": ["PUT"],
  "/api/admin/users": ["GET", "POST"],
  "/api/admin/users/[id]": ["DELETE", "PATCH"],
  "/api/approvals": ["GET"],
  "/api/approvals/[id]/decide": ["POST"],
  "/api/auth/login": ["POST"],
  "/api/auth/logout": ["POST"],
  "/api/auth/password": ["POST"],
  "/api/bookings": ["POST"],
  "/api/bookings/[id]": ["PATCH"],
  "/api/bookings/[id]/cancel": ["POST"],
  "/api/bookings/[id]/decision": ["POST"],
  "/api/chat": ["POST"],
  "/api/conversations": ["GET", "POST"],
  "/api/conversations/[id]": ["DELETE", "GET", "PATCH"],
  "/api/conversations/[id]/messages/[mid]": ["PATCH"],
  "/api/conversations/[id]/messages/[mid]/stop": ["POST"],
  "/api/favorites": ["GET", "POST"],
  "/api/internal/runtime": ["GET"],
  "/api/internal/tools/[name]": ["POST"],
  "/api/jobs/[id]": ["GET"],
  "/api/jobs/[id]/cancel": ["POST"],
  "/api/memory": ["GET", "POST"],
  "/api/memory/[id]": ["DELETE"],
  "/api/notifications/read": ["POST"],
  "/api/platform/audit": ["GET"],
  "/api/platform/auth/login": ["POST"],
  "/api/platform/auth/logout": ["POST"],
  "/api/platform/auth/mfa": ["GET", "POST"],
  "/api/platform/enrollment-tokens": ["GET", "POST"],
  "/api/platform/installations": ["GET"],
  "/api/platform/installations/[id]/revoke": ["POST"],
  "/api/platform/lab/decide": ["POST"],
  "/api/platform/lab/personas": ["GET"],
  "/api/platform/lab/run": ["POST"],
  "/api/platform/me": ["GET"],
  "/api/platform/releases": ["GET", "POST"],
  "/api/platform/releases/[id]/revoke": ["POST"],
  "/api/platform/revocations/keys": ["POST"],
  "/api/platform/specs": ["GET", "POST"],
  "/api/platform/workers": ["GET", "POST"],
  "/api/platform/workers/[id]": ["GET", "PUT"],
  "/api/platform/workers/[id]/versions/[version]/publish": ["POST"],
  "/api/platform/workers/[id]/versions/[version]/request-review": ["POST"],
  "/api/platform/workers/[id]/versions/[version]/retire": ["POST"],
  "/api/platform/workers/[id]/versions/[version]/review": ["POST"],
  "/api/platform/workers/generate": ["POST"],
  "/api/release/bundles/[id]": ["GET"],
  "/api/release/enroll": ["POST"],
  "/api/release/releases/[channel]/latest": ["GET"],
  "/api/release/revocations": ["GET"],
  "/api/rooms/search": ["POST"],
};

/** Methods the portal implements anywhere. Anything else (TRACE, PURGE, ...) is 501. */
export const KNOWN_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

// static segments beat [id] segments, as in Next.js routing ("/workers/generate" before "/workers/[id]")
const PATTERNS = Object.keys(API_METHODS)
  .map((route) => ({ route, re: new RegExp("^" + route.replace(/\[[^\]]+\]/g, "[^/]+") + "/?$"), dynamic: (route.match(/\[/g) ?? []).length }))
  .sort((a, b) => a.dynamic - b.dynamic);

/** The methods the route at this path allows (HEAD comes with GET, OPTIONS always), or null when no route has this path. */
export function allowedMethods(pathname: string): string[] | null {
  const hit = PATTERNS.find((p) => p.re.test(pathname));
  if (!hit) return null;
  const m = new Set(API_METHODS[hit.route]);
  if (m.has("GET")) m.add("HEAD");
  m.add("OPTIONS");
  return [...m].sort();
}
