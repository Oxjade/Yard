// Stand-in for tools/db-migrate.mjs (rehearsal only): advisory lock, applies drizzle/*.sql in order,
// one transaction each. --check exits 3 when anything is pending.
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
const require = createRequire(path.join(process.cwd(), "server.js"))
const { Client } = require("pg")
const check = process.argv.includes("--check")
const c = new Client({ connectionString: process.env.DATABASE_URL })
await c.connect()
await c.query("select pg_advisory_lock(424242)")
await c.query("create schema if not exists yard_dummy")
await c.query("create table if not exists yard_dummy.migrations (name text primary key, applied_at timestamptz default now())")
const files = readdirSync("drizzle").filter((f) => f.endsWith(".sql")).sort()
const done = new Set((await c.query("select name from yard_dummy.migrations")).rows.map((r) => r.name))
const pending = files.filter((f) => !done.has(f))
if (check) {
  console.log(`migrations: applied ${done.size} (journal ${files.length})`)
  await c.end()
  process.exit(pending.length ? 3 : 0)
}
for (const f of pending) {
  await c.query("begin")
  try {
    await c.query(readFileSync(path.join("drizzle", f), "utf8"))
    await c.query("insert into yard_dummy.migrations(name) values ($1)", [f])
    await c.query("commit")
    console.log(`applied ${f}`)
  } catch (e) {
    await c.query("rollback")
    console.error(`migration ${f} failed: ${e.message}`)
    await c.end()
    process.exit(1)
  }
}
console.log(`migrations: applied ${files.length} (journal ${files.length}) as ${process.getuid()}`)
await c.end()
