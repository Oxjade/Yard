#!/usr/bin/env node
// npm run db:migrate [-- --check]
//
// Postgres only (DATABASE_URL set): applies the pending migrations in drizzle/ under an advisory
// lock (two runs never migrate at once; the second waits, then finds nothing to do), then seeds
// reference data (categories, holidays) always and demo fixtures only when YARD_SEED_DEMO=1 (never
// on a real deployment). The server never migrates Postgres at boot: it refuses to serve while the
// database is behind its build, so a release runs this BEFORE it switches over (deploy/release.sh).
// With PGlite (no DATABASE_URL) the server migrates and seeds itself at boot; this prints so and
// exits 0.
//
//   --check   only report: exit 0 when current, 3 when migrations are pending (nothing changes)
//
// Environment, the way `next start` sees it: .env.production.local, .env.local, .env.production,
// .env; variables already set win. NODE_ENV defaults to production. Exit codes: 0 done, 1 failed,
// 2 usage, 3 (--check) pending.
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { parseArgs, parseEnv } from "node:util"

let args
try {
  args = parseArgs({ options: { check: { type: "boolean", default: false }, help: { type: "boolean", short: "h", default: false } }, strict: true }).values
} catch (e) {
  console.error(`${e.message}\nUsage: npm run db:migrate [-- --check]`)
  process.exit(2)
}
if (args.help) {
  console.log("Usage: npm run db:migrate [-- --check]")
  process.exit(0)
}

process.env.NODE_ENV ||= "production"
const nodeEnv = process.env.NODE_ENV
for (const file of [`.env.${nodeEnv}.local`, nodeEnv === "test" ? null : ".env.local", `.env.${nodeEnv}`, ".env"]) {
  if (!file) continue
  const p = path.join(process.cwd(), file)
  if (!existsSync(p)) continue
  for (const [k, v] of Object.entries(parseEnv(readFileSync(p, "utf8")))) if (process.env[k] === undefined) process.env[k] = v
}
if (!process.env.DATABASE_URL?.trim()) {
  console.log("DATABASE_URL is not set: PGlite migrates and seeds when the server boots. Nothing to do.")
  process.exit(0)
}
globalThis.__yard = { ...(globalThis.__yard ?? {}), schedulers: true }

try {
  const { migrateDatabase } = await import("@/server/db/migrate")
  const r = await migrateDatabase({ checkOnly: args.check })
  if (args.check) {
    console.log(`migrations: ${r.after.applied} applied, ${r.after.expected} in this build — ${r.after.pending ? "PENDING" : "current"}`)
    process.exit(r.after.pending ? 3 : 0)
  }
  const added = r.after.applied - r.before.applied
  console.log(`migrations: applied ${added} now (${r.after.applied} recorded, ${r.after.expected} in this build)${r.after.pending ? " — STILL PENDING" : ""}`)
  if (r.seeds) {
    console.log(`seeds: ${r.seeds.ran.length ? `ran ${r.seeds.ran.join(", ")}` : "nothing new"}${r.seeds.waiting.length ? `; waiting ${r.seeds.waiting.join(", ")}` : ""}${r.seeds.failed.length ? `; FAILED ${r.seeds.failed.join(", ")}` : ""}`)
  }
  console.log(`done in ${r.ms} ms`)
  process.exit(r.after.pending || r.seeds?.failed.length ? 1 : 0)
} catch (e) {
  console.error(`db:migrate failed: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
}
