import { NextResponse, type NextRequest } from "next/server";
import { allowedMethods, KNOWN_METHODS } from "./lib/api-methods";
import { isPlatform, isPlatformPath } from "./lib/role";

/**
 * Request guard (M6.3). Cookies are SameSite=Lax and httpOnly, and this adds a second wall against cross-site request forgery:
 * a browser request that changes something (POST, PUT, PATCH, DELETE) is refused if it says it came from another site.
 *  - Origin, when present, must be this site.
 *  - Sec-Fetch-Site must not be cross-site.
 * Programs without a browser (the tool gateway, tests) send neither header and are judged by their own credentials instead.
 * The internal API is key-protected and never reachable from the internet (tunnel rule), so it is left alone.
 */
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export function proxy(req: NextRequest) {
  // /API/..., /Api/...: routes are case-sensitive, so these are no endpoint; say so in JSON, not with the HTML 404 page (QA DEF-44).
  // Everything else outside /api and /platform is a page, which this guard leaves alone.
  const p = req.nextUrl.pathname;
  if (!p.startsWith("/api/") && !p.startsWith("/platform")) {
    return /^\/api(\/|$)/i.test(p) ? NextResponse.json({ error: "No such API endpoint.", code: "no_such_endpoint" }, { status: 404 }) : NextResponse.next();
  }
  // Studio and the release service exist only on the platform instance. Anywhere else they are simply not there.
  if (isPlatformPath(req.nextUrl.pathname) && !isPlatform()) {
    return req.nextUrl.pathname.startsWith("/api/") ? NextResponse.json({ error: "Not found." }, { status: 404 }) : new NextResponse("Not found", { status: 404 });
  }
  // A method the route does not take is 405 with Allow, and one the portal never implements (TRACE, PURGE) is 501, both in JSON (QA DEF-45).
  // Next.js would answer an empty 405 without Allow, and a 500 for TRACE.
  if (p.startsWith("/api/")) {
    const allow = allowedMethods(p);
    const headers = allow ? { Allow: allow.join(", ") } : undefined;
    if (!KNOWN_METHODS.has(req.method)) {
      return NextResponse.json({ error: `The API does not support ${req.method}.`, code: "method_not_implemented" }, { status: 501, headers });
    }
    // OPTIONS says what the route takes, signed in or not
    if (allow && req.method === "OPTIONS") return new NextResponse(null, { status: 204, headers });
    if (allow && !allow.includes(req.method)) {
      return NextResponse.json({ error: `This API endpoint does not accept ${req.method}.`, code: "method_not_allowed" }, { status: 405, headers });
    }
  }
  // Signed out: the API says so, instead of each route answering "your role cannot ..." (QA DEF-30). Sign-in itself, the key-protected
  // internal API and the platform's own APIs (separate sign-in) are left to their routes. An expired cookie still reaches the route.
  // "digi_session" is COOKIE in lib/session.ts, not imported here because that module pulls in the database.
  if (req.nextUrl.pathname.startsWith("/api/") && !/^\/api\/(auth|internal|platform|release)(\/|$)/.test(req.nextUrl.pathname) && !req.cookies.get("digi_session")?.value) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  if (SAFE.has(req.method) || req.nextUrl.pathname.startsWith("/api/internal/")) return NextResponse.next();
  const origin = req.headers.get("origin");
  const site = req.headers.get("sec-fetch-site");
  const host = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "").split(",")[0]!.trim().toLowerCase();
  let bad = site === "cross-site";
  if (origin) {
    try { bad = bad || new URL(origin).host.toLowerCase() !== host; } catch { bad = true; }
  }
  if (bad) return NextResponse.json({ error: "This request did not come from Digi." }, { status: 403 });
  return NextResponse.next();
}

// Pages are matched only so that a wrongly capitalised /api path gets a JSON answer; static files are not.
export const config = { matcher: ["/api/:path*", "/platform/:path*", "/platform", "/((?!_next/|api/|favicon|.*\\.[a-z0-9]+$).*)"] };
