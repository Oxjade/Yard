#!/usr/bin/env node
// node scripts/check-env.mjs  (tools/check-env.mjs in a release)
//
// Validates the server's configuration exactly as the server will at startup (src/server/env.ts)
// and prints EVERY problem at once, one per line, so a deployment is fixed in one pass rather than
// one restart per missing variable. Then a one-line summary of what the server will use (database
// kind, environment name, payments mode, public URL) without any secret. Exit 0 = valid, 1 = not.
// Reads the environment like `next start`: .env.production.local, .env.local, .env.production,
// .env; variables already set win. NODE_ENV defaults to production.
//
// Search engines (optional; docs/SEO-AI.md). A malformed value is warned about and ignored, never fatal:
//   GOOGLE_SITE_VERIFICATION       Search Console meta-tag token(s), comma separated. Baked into prerendered
//                                  pages: rebuild (sudo yard-update) after changing it.
//   BING_SITE_VERIFICATION         Bing Webmaster Tools msvalidate.01 token(s), comma separated. Same rebuild rule.
//   GOOGLE_SITE_VERIFICATION_FILE  googleXXXX.html: served at /googleXXXX.html. Read at runtime (restart).
//   INDEXNOW_KEY                   8-128 hex characters (openssl rand -hex 16). Turns IndexNow on and serves
//                                  /<key>.txt. Read at runtime (restart).
//   INDEXNOW_ENDPOINT              Testing only: where submissions go (default https://api.indexnow.org/indexnow).
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { parseEnv } from "node:util"

process.env.NODE_ENV ||= "production"
const nodeEnv = process.env.NODE_ENV
for (const file of [`.env.${nodeEnv}.local`, nodeEnv === "test" ? null : ".env.local", `.env.${nodeEnv}`, ".env"]) {
  if (!file) continue
  const p = path.join(process.cwd(), file)
  if (!existsSync(p)) continue
  for (const [k, v] of Object.entries(parseEnv(readFileSync(p, "utf8")))) if (process.env[k] === undefined) process.env[k] = v
}

try {
  const { getEnv } = await import("@/server/env")
  const env = getEnv()
  const db = env.databaseUrl ? `Postgres (${new URL(env.databaseUrl).host}${new URL(env.databaseUrl).pathname})` : "PGlite (embedded)"
  const seo = env.seo
  const verify = [seo.googleVerification.length ? `google meta ×${seo.googleVerification.length}` : null, seo.bingVerification.length ? `bing meta ×${seo.bingVerification.length}` : null, seo.googleFile ? `google file ${seo.googleFile}` : null].filter(Boolean)
  console.log(
    `configuration OK: ${env.nodeEnv}, env ${env.envName}, ${db}, payments ${env.payments}, ${env.publicUrl}, data ${env.dataDir}, proxy hops ${env.trustedProxyHops}, demo ${env.seedDemo ? "ON" : "off"}, site verification ${verify.length ? verify.join(" + ") : "none"}, indexnow ${seo.indexNowKey ? "on" : "off"}`,
  )
  process.exit(0)
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
}
