/** There is no sitemap: a plain 404, not the app's HTML 404 page (QA DEF-09). Same answer as Caddy's. */
export function GET() {
  return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
