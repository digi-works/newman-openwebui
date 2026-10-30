/**
 * Digi is a signed-in app, so crawlers are asked to stay out; plain text, not the app's HTML 404 page (QA DEF-09).
 * Caddy answers the same in front of the portal; this covers a server whose Caddy has not loaded that Caddyfile.
 */
export const dynamic = "force-static";

export function GET() {
  return new Response("User-agent: *\nDisallow: /\n", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
