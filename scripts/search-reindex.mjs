#!/usr/bin/env node
// npm run search:reindex
//
// Rebuilds the search index (every brand and product: what Shop, Search and category pages list)
// from the catalogue. Safe to run any time; yard-update runs it after migrations so a release
// always starts with an index that matches each brand's current status.
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { parseEnv } from "node:util"

process.env.NODE_ENV ||= "production"
for (const file of [`.env.${process.env.NODE_ENV}.local`, ".env.local", `.env.${process.env.NODE_ENV}`, ".env"]) {
  const p = path.join(process.cwd(), file)
  if (!existsSync(p)) continue
  for (const [k, v] of Object.entries(parseEnv(readFileSync(p, "utf8")))) if (process.env[k] === undefined) process.env[k] = v
}
if (!process.env.DATABASE_URL?.trim()) {
  console.log("DATABASE_URL is not set: the server indexes PGlite itself. Nothing to do.")
  process.exit(0)
}
globalThis.__yard = { ...(globalThis.__yard ?? {}), schedulers: true }

try {
  const t = Date.now()
  const { reindexAll } = await import("@/server/search")
  const r = await reindexAll()
  console.log(`search: re-indexed ${r.brands} brands and ${r.products} products in ${Date.now() - t} ms`)
  process.exit(0)
} catch (e) {
  console.error(`search:reindex failed: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
}
