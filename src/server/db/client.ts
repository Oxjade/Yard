import "server-only"
import { chmodSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { getEnv, isBuildPhase } from "../env"
import { log } from "../log"
import { yard } from "../state"
import { acquireLock } from "./lock"
import * as schema from "./schema"

export type Schema = typeof schema
export type Root = PgliteDatabase<Schema> & { $client: PGlite }

/**
 * The single PGlite instance for this process (§1.3). Only src/server/db/** may import this
 * (ESLint no-restricted-imports); everything else uses db()/withTx() from "@/server/db".
 */
export function getDb(): Promise<Root> {
  const pending = checkJournal()
  if (pending) return pending
  return (yard.db ??= boot().catch((e) => {
    yard.db = undefined
    throw e
  })) as Promise<Root>
}

const journalFile = () => path.join(process.cwd(), "drizzle", "meta", "_journal.json")
const journalCount = () => (JSON.parse(readFileSync(journalFile(), "utf8")) as { entries: unknown[] }).entries.length

/**
 * A long-lived server and new migrations (§1.3). In development, a migration added to drizzle/
 * while the server runs is applied in-process before the next query (F2's additive checkpoint,
 * so the shared dev server needn't restart under everyone's streams): every query reaches PGlite
 * through getDb() or a transaction that started there, and the journal is written before any
 * schema file that needs it. Production never changes its migrations under a running process;
 * there a changed journal is only reported.
 */
function checkJournal(): Promise<Root> | null {
  const m = yard.migrations
  if (!m || !yard.db) return null
  if (m.applying) return m.applying as Promise<Root>
  if (Date.now() - m.checkedAt < 1000) return null
  m.checkedAt = Date.now()
  let count: number
  try {
    count = journalCount()
  } catch {
    return null // journal unreadable mid-write; try again later
  }
  if (count === m.applied) return null
  if (!getEnv().dev) {
    if (!m.warned) {
      m.warned = true
      log.warn("[yard] Schema changed: restart the server to apply the new migrations")
    }
    return null
  }
  const from = m.applied
  const applying = (yard.db as Promise<Root>)
    .then(async (root) => {
      await migrate(root, { migrationsFolder: path.join(process.cwd(), "drizzle") })
      m.applied = journalCount()
      log.info(`[yard] applied ${m.applied - from} new migration${m.applied - from === 1 ? "" : "s"} in-process (journal ${from} → ${m.applied})`)
      return root
    })
    .catch((e) => {
      m.warned = true
      log.error("[yard] Schema changed but the new migration failed; restart npm run dev", e)
      m.applied = count
      return yard.db as Promise<Root>
    })
    .finally(() => {
      m.applying = undefined
    })
  m.applying = applying
  return applying
}

/** Dev watchdog: any query that takes more than 1 s from call to resolve is logged (§1.3). */
function watch(client: PGlite): PGlite {
  if (!getEnv().dev) return client
  for (const method of ["query", "exec"] as const) {
    const original = client[method].bind(client) as (...args: unknown[]) => Promise<unknown>
    const wrapped = async (...args: unknown[]) => {
      const sql = String(args[0] ?? "").replace(/\s+/g, " ").trim().slice(0, 80)
      const started = performance.now()
      const timer = setTimeout(() => log.warn(`[yard] slow or blocked query (still waiting after 1 s): ${sql}`), 1000)
      try {
        return await original(...args)
      } finally {
        clearTimeout(timer)
        const ms = performance.now() - started
        if (ms > 1000) log.warn(`[yard] slow or blocked query (${(ms / 1000).toFixed(1)} s): ${sql}`)
      }
    }
    ;(client as unknown as Record<string, unknown>)[method] = wrapped
  }
  return client
}

/**
 * Removes group and other access under `dir` (PGlite creates files 0666 and folders 0755 through
 * its Node FS layer, whatever the process umask says). Returns how many entries it changed.
 */
export function privatiseTree(dir: string): number {
  let changed = 0
  const walk = (p: string) => {
    let st
    try {
      st = statSync(p)
    } catch {
      return
    }
    if (st.mode & 0o077) {
      try {
        chmodSync(p, st.mode & 0o700)
        changed++
      } catch {
        /* not ours to change; the private parent directory still guards it */
      }
    }
    if (st.isDirectory()) for (const name of readdirSync(p)) walk(path.join(p, name))
  }
  walk(dir)
  return changed
}

async function boot(): Promise<Root> {
  // 1. Any accidental build-time read is loud.
  if (isBuildPhase()) throw new Error("DB access during next build")
  const started = Date.now()
  const env = getEnv()

  // New files this process creates (database, uploads, secrets) are private to this user.
  try {
    process.umask(0o077)
  } catch {
    /* worker threads can't change the umask; privatiseTree below still applies */
  }

  // 2. The data directory: outside the repo by default, private to this user. Production refuses
  // to open a database other local users can reach; development warns.
  mkdirSync(env.dataDir, { recursive: true, mode: 0o700 })
  if ((statSync(env.dataDir).mode & 0o077) !== 0) {
    const msg = `[yard] ${env.dataDir} is readable by other users; run chmod 700 on it`
    if (!env.dev) throw new Error(`${msg}. Yard won't open its database there in production.`)
    log.warn(msg)
  }

  // 3. One process per data directory and NODE_ENV.
  acquireLock(env.dataDir, env.nodeEnv)

  // 4. Optional wipe (development only).
  const pgDir = path.join(env.envDir, "pg")
  if (env.resetDb) {
    rmSync(pgDir, { recursive: true, force: true })
    rmSync(path.join(env.envDir, "uploads"), { recursive: true, force: true })
    log.warn("[yard] YARD_RESET_DB=1: wiped the database and uploads.")
  }
  mkdirSync(env.envDir, { recursive: true, mode: 0o700 })
  mkdirSync(path.join(env.envDir, "uploads"), { recursive: true, mode: 0o700 })

  // 5. Open (first boot runs initdb, ~5 s; a reopen takes ~180 ms).
  const client = new PGlite(pgDir)
  await client.waitReady
  const loosened = privatiseTree(env.envDir)
  if (loosened) log.info(`[yard] made ${loosened} database and upload ${loosened === 1 ? "entry" : "entries"} private (go-rwx)`)

  // 6. Drizzle over the watched client, with the runtime schema (no social_tokens).
  const root = drizzle(watch(client), { schema }) as Root

  // 7. Migrations, in-process only.
  await migrate(root, { migrationsFolder: path.join(process.cwd(), "drizzle") })
  yard.migrations = { applied: journalCount(), checkedAt: Date.now(), warned: false }

  // 8. Seeds (each module in its own transaction on this root).
  const { runSeeds } = await import("./seed")
  await runSeeds(root)

  // 9. Close cleanly on shutdown without swallowing the default signal behaviour.
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.once(sig, () => {
      void client.close().finally(() => {
        if (process.listenerCount(sig) === 0) process.kill(process.pid, sig)
      })
    })
  }

  // 10. Timers, once per process.
  const { startSchedulers } = await import("../schedulers")
  startSchedulers()

  log.info(`[yard] database ready in ${Date.now() - started} ms (${pgDir})`)
  return root
}
