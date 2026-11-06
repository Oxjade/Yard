import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // The dev-mode badge sits over the Studio/Admin sidebar footer and the phone tab bar.
  devIndicators: false,
  partialPrefetching: true,
  // PGlite loads pglite.wasm, pglite.data and initdb.wasm through new URL(…, import.meta.url);
  // bundling it breaks those paths, so the server requires it from node_modules instead.
  serverExternalPackages: ["@electric-sql/pglite"],
  // Every page and route except /api/media/*, which sets its own stricter headers. No page frames
  // our own origin (the Studio PreviewFrame is a div), so frame-ancestors 'none' breaks nothing.
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
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
