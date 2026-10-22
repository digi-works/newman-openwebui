/**
 * Any /api path no route handles answers in JSON, like every other API error, instead of the app's HTML 404 page (QA DEF-44).
 * Real routes always win over this catch-all. Caddy does the same in front of the portal; this covers the portal on its own.
 */
const noSuchEndpoint = () => Response.json({ error: "No such API endpoint.", code: "no_such_endpoint" }, { status: 404 });

export const GET = noSuchEndpoint;
export const HEAD = noSuchEndpoint;
export const POST = noSuchEndpoint;
export const PUT = noSuchEndpoint;
export const PATCH = noSuchEndpoint;
export const DELETE = noSuchEndpoint;
export const OPTIONS = noSuchEndpoint;
