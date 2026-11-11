#!/usr/bin/env node
// node scripts/check-env.mjs  (tools/check-env.mjs in a release)
//
// Validates the server's configuration exactly as the server will at startup (src/server/env.ts)
// and prints EVERY problem at once, one per line, so a deployment is fixed in one pass rather than
// one restart per missing variable. Then a one-line summary of what the server will use (database
// kind, environment name, payments mode, public URL) without any secret. Exit 0 = valid, 1 = not.
// Reads the environment like `next start`: .env.production.local, .env.local, .env.production,
// .env; variables already set win. NODE_ENV defaults to production.
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
  console.log(`configuration OK: ${env.nodeEnv}, env ${env.envName}, ${db}, payments ${env.payments}, ${env.publicUrl}, data ${env.dataDir}, proxy hops ${env.trustedProxyHops}, demo ${env.seedDemo ? "ON" : "off"}`)
  process.exit(0)
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
}
