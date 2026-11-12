import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

/**
 * A production build never carries the demo switches (hosting plan C.5): they are runtime-only
 * (`npm run start:demo` sets them when it starts the server, not when it builds), so a build that
 * reaches a server can't have demo sign-in or demo data baked into a prerendered page.
 */
const DEMO_FLAGS = ["YARD_SEED_DEMO", "YARD_DEMO_AUTH", "YARD_DEMO_ADMIN"] as const;

function assertNoDemoFlags() {
  const on = DEMO_FLAGS.filter((k) => (process.env[k] ?? "").trim() !== "" && process.env[k]!.trim() !== "0");
  if (on.length) {
    throw new Error(
      `[yard] ${on.join(", ")} ${on.length === 1 ? "is" : "are"} set for a production build. Demo flags are runtime-only: unset them for \`next build\` (npm run start:demo sets them when it starts the server).`,
    );
  }
}

const nextConfig = (phase: string): NextConfig => {
  if (phase === PHASE_PRODUCTION_BUILD) assertNoDemoFlags();
  return {
    cacheComponents: true,
    // The dev-mode badge sits over the Studio/Admin sidebar footer and the phone tab bar.
    devIndicators: false,
    experimental: {
      // src/proxy.ts runs in front of /api/* (not uploads or webhooks), and Next buffers a proxied
      // request's body in memory: cap that buffer at the JSON API limit (the proxy refuses a larger
      // Content-Length outright; each route's own cap is lower still, 64 KB by default).
      proxyClientMaxBodySize: "1mb",
    },
    partialPrefetching: true,
    poweredByHeader: false,
    // Small servers (1-2 GB) run out of memory on the type check during `next build`. The code is
    // type-checked before every merge, so YARD_SKIP_TYPECHECK=1 lets a server build skip it.
    typescript: { ignoreBuildErrors: process.env.YARD_SKIP_TYPECHECK === "1" },
    // A self-contained server (.next/standalone/server.js plus the node_modules it traces), so a
    // deployment needs no npm install and no build on the server. The release packager copies
    // public/, .next/static and drizzle/ next to it (deploy/).
    output: "standalone",
    // The project itself is the tracing root (builds run from it): a lockfile in a parent folder
    // must never make Next nest server.js one level down inside .next/standalone.
    outputFileTracingRoot: process.cwd(),
    // Files read at runtime through process.cwd(), which the tracer can't see.
    outputFileTracingIncludes: {
      "/vendor/world-atlas/*": ["node_modules/world-atlas/*.json"],
      "/vendor/maplibre-gl-worker.mjs": ["node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs"],
      "/vendor/around-coast/*": ["src/lib/around/coast/**"],
    },
    // PGlite loads pglite.wasm, pglite.data and initdb.wasm through new URL(…, import.meta.url);
    // bundling it breaks those paths, so the server requires it from node_modules instead. (pg, the
    // Postgres driver, is on Next's own external list.)
    serverExternalPackages: ["@electric-sql/pglite"],
    // Every page and route except /api/media/*, which sets its own stricter headers. No page frames
    // our own origin (the Studio PreviewFrame is a div), so frame-ancestors 'none' breaks nothing.
    // HSTS is set by the reverse proxy (deploy/), so a local http:// run isn't pinned to https.
    async headers() {
      return [
        {
          source: "/((?!api/media/).*)",
          headers: [
            { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
            { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
            { key: "X-Content-Type-Options", value: "nosniff" },
            { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=()" },
          ],
        },
      ];
    },
    turbopack: {
      root: process.cwd(),
      rules: {
        "*.css": {
          loaders: ["@tailwindcss/turbopack"],
          as: "*.css",
        },
      },
    },
  };
};

export default nextConfig;
