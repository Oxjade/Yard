#!/usr/bin/env node
// On the server (a release built by CI, run as the yard user with /etc/yard.env loaded):
//   sudo runuser -u yard -- bash -c 'set -a; . /etc/yard.env; set +a; cd /home/yard/app && node tools/check-env.mjs'
// In a checkout with dev dependencies:
//   node --conditions=react-server --import tsx scripts/check-env.mjs
//
// tools/check-env.mjs is THIS file bundled into plain JavaScript by scripts/bundle-tools.mjs (npm run
// build's postbuild), because a release has no TypeScript loader for the "@/server" path alias.
// Run as plain `node scripts/check-env.mjs` where the alias can't load, it hands over to
// tools/check-env.mjs when that exists, so the old command keeps working in a release.
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
//
// Yard's own social profiles (optional). Full https URLs on that network's domain; a malformed one is
// warned about and its icon hidden. Read at request time (restart, no rebuild): footer, Your World,
// Support, the home page's JSON-LD sameAs and llms.txt.
//   YARD_SOCIAL_INSTAGRAM  YARD_SOCIAL_TIKTOK  YARD_SOCIAL_X  YARD_SOCIAL_YOUTUBE  YARD_SOCIAL_THREADS
//   YARD_SOCIAL_FACEBOOK   YARD_SOCIAL_SNAPCHAT  YARD_SOCIAL_WHATSAPP  YARD_SOCIAL_LINKEDIN
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseEnv } from "node:util"

process.env.NODE_ENV ||= "production"
const nodeEnv = process.env.NODE_ENV
for (const file of [`.env.${nodeEnv}.local`, nodeEnv === "test" ? null : ".env.local", `.env.${nodeEnv}`, ".env"]) {
  if (!file) continue
  const p = path.join(process.cwd(), file)
  if (!existsSync(p)) continue
  for (const [k, v] of Object.entries(parseEnv(readFileSync(p, "utf8")))) if (process.env[k] === undefined) process.env[k] = v
}

// The server's own validation. Plain `node` can't resolve the "@/server" alias (nor load TypeScript):
// then run the bundled tools/check-env.mjs of this release instead, with the same environment.
let getEnv
try {
  ;({ getEnv } = await import("@/server/env"))
} catch (e) {
  const missing = e?.code === "ERR_MODULE_NOT_FOUND" || e?.code === "ERR_UNSUPPORTED_DIR_IMPORT" || e?.code === "ERR_UNKNOWN_FILE_EXTENSION" || /server-only|cannot be imported/i.test(String(e?.message))
  if (!missing) throw e
  const here = path.dirname(fileURLToPath(import.meta.url))
  const bundled = [path.join(process.cwd(), "tools", "check-env.mjs"), path.join(here, "..", "tools", "check-env.mjs")].find((p) => existsSync(p) && path.resolve(p) !== fileURLToPath(import.meta.url))
  if (!bundled) {
    console.error(
      "check-env: this Node can't load the server's TypeScript sources here, and there is no bundled tools/check-env.mjs.\n" +
        "  In a release: cd to the release folder (/home/yard/app) and run node tools/check-env.mjs (CI's npm run build bundles it).\n" +
        "  In a checkout: node --conditions=react-server --import tsx scripts/check-env.mjs (or npm run build first).",
    )
    process.exit(1)
  }
  const r = spawnSync(process.execPath, [bundled, ...process.argv.slice(2)], { stdio: "inherit", env: process.env })
  process.exit(r.status ?? 1)
}

try {
  const env = getEnv()
  const db = env.databaseUrl ? `Postgres (${new URL(env.databaseUrl).host}${new URL(env.databaseUrl).pathname})` : "PGlite (embedded)"
  const seo = env.seo
  const verify = [seo.googleVerification.length ? `google meta ×${seo.googleVerification.length}` : null, seo.bingVerification.length ? `bing meta ×${seo.bingVerification.length}` : null, seo.googleFile ? `google file ${seo.googleFile}` : null].filter(Boolean)
  console.log(
    `configuration OK: ${env.nodeEnv}, env ${env.envName}, ${db}, payments ${env.payments}, ${env.publicUrl}, data ${env.dataDir}, proxy hops ${env.trustedProxyHops}, demo ${env.seedDemo ? "ON" : "off"}, site verification ${verify.length ? verify.join(" + ") : "none"}, indexnow ${seo.indexNowKey ? "on" : "off"}, socials ${env.socials.length ? env.socials.map((s) => s.key).join(" ") : "none"}`,
  )
  process.exit(0)
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
}
