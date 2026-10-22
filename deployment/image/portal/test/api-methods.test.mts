import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

const { API_METHODS, allowedMethods } = await import("@/lib/api-methods");

/** Every API route file and the methods it exports, read from the source the way Next.js routes them. */
function scan(dir: string, found: Record<string, string[]> = {}) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) scan(p, found);
    else if (name === "route.ts" && !p.includes("[...")) {
      const methods = [...new Set([...readFileSync(p, "utf8").matchAll(/export (?:async function|const) (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map((m) => m[1]!))].sort();
      found[dir.replace(/\\/g, "/").replace(/^.*src\/app/, "")] = methods;
    }
  }
  return found;
}

describe("API methods (DEF-45)", () => {
  test("the method list in lib/api-methods.ts matches the route files", () => {
    const actual = scan(new URL("../src/app/api", import.meta.url).pathname);
    for (const [route, methods] of Object.entries(actual)) {
      assert.deepEqual(API_METHODS[route], methods, `lib/api-methods.ts needs:  "${route}": ${JSON.stringify(methods)}`);
    }
    for (const route of Object.keys(API_METHODS)) assert.ok(actual[route], `lib/api-methods.ts lists ${route}, which has no route file`);
  });

  test("Allow includes HEAD with GET and always OPTIONS; static segments win over [id]", () => {
    assert.deepEqual(allowedMethods("/api/conversations"), ["GET", "HEAD", "OPTIONS", "POST"]);
    assert.deepEqual(allowedMethods("/api/conversations/123/messages/456/stop"), ["OPTIONS", "POST"]);
    assert.deepEqual(allowedMethods("/api/platform/workers/generate"), ["OPTIONS", "POST"]);
    assert.deepEqual(allowedMethods("/api/platform/workers/abc"), ["GET", "HEAD", "OPTIONS", "PUT"]);
    assert.equal(allowedMethods("/api/does-not-exist"), null);
  });
});
