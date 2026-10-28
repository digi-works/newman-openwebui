import type { NextConfig } from "next";

// HSTS and CSP are sent by the portal itself, not only by the Caddyfile: a server that only loads a new image and keeps an older
// Caddyfile still gets them (QA DEF-06). Same values as deployment/aws/Caddyfile; test/registry.test.mts checks they agree.
// Next.js renders inline scripts and styles, and Digi's in-chat forms (sandboxed iframes) use Google Fonts. next dev also needs eval.
const HSTS = "max-age=31536000; includeSubDomains";
const CSP = `default-src 'self'; script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`;

const nextConfig: NextConfig = {
  output: "standalone",
  // No "X-Powered-By: Next.js": responses do not say what the site is built with (QA DEF-08).
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: HSTS },
          { key: "Content-Security-Policy", value: CSP },
        ],
      },
      {
        // API answers carry people's data and are never stored by a browser or proxy, like the pages (QA DEF-56).
        // The chat stream sets its own (no-store, no-transform), so it is left out here.
        source: "/api/:path((?!chat$).*)",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
