import "server-only"
import { chmodSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import path from "node:path"
import type { PGlite } from "@electric-sql/pglite"
import type { PgliteDatabase } from "drizzle-orm/pglite"
import { getEnv, isBuildPhase } from "../env"
import { log } from "../log"
import { yard } from "../state"
import { acquireLock, acquireServerAdvisoryLock } from "./lock"
import * as schema from "./schema"

export type Schema = typeof schema
/**
 * The drizzle database. Two drivers sit behind it (§1.3, hosting A.1): node-postgres when
 * DATABASE_URL is set (a real deployment), the embedded PGlite otherwise (development, tests, the
 * local demo). Both are drizzle's pg-core database; the type is PGlite's because that is what the
 * code was written against, and everything the code uses (query builder, relational queries,
 * transactions, execute() → { rows }) behaves the same on both (see pg.ts for the value types).
 */
export type Root = PgliteDatabase<Schema>

/** Which database this process uses. */
export const dbKind = (): "postgres" | "pglite" => (getEnv().databaseUrl ? "postgres" : "pglite")

/**
 * The single PGlite instance for this process (§1.3). Only src/server/db/** may import this
 * (ESLint no-restricted-imports); everything else uses db()/withTx() from "@/server/db".
 */
export function getDb(): Promise<Root> {
  const pending = yard.migrations ? checkJournal() : null
  if (pending) return pending
  return (yard.db ??= boot().catch((e) => {
    yard.db = undefined
    throw e
  })) as Promise<Root>
}

export const migrationsFolder = () => path.join(/*turbopackIgnore: true*/ process.cwd(), "drizzle")
const journalFile = () => path.join(migrationsFolder(), "meta", "_journal.json")
/** The migrations this build ships (drizzle/meta/_journal.json): how many, and the newest one's timestamp. */
export function journal(): { count: number; lastWhen: number } {
  const entries = (JSON.parse(readFileSync(journalFile(), "utf8")) as { entries: { when: number }[] }).entries
  return { count: entries.length, lastWhen: entries.reduce((m, e) => Math.max(m, Number(e.when) || 0), 0) }
}
const journalCount = () => journal().count

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
      const { migrate } = await import("drizzle-orm/pglite/migrator")
      await migrate(root, { migrationsFolder: migrationsFolder() })
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

/** The schema state of a Postgres database: migrations recorded by drizzle vs those this build ships. */
export type MigrationState = { applied: number; expected: number; pending: boolean }

/** Thrown by getDb() on Postgres while the database is behind this build's migrations. */
export class MigrationsPendingError extends Error {
  constructor(public state: MigrationState) {
    super(`The database is behind this build's migrations (${state.applied} applied, ${state.expected} expected). Run npm run db:migrate first.`)
    this.name = "MigrationsPendingError"
  }
}

/**
 * Reads drizzle's migration table on Postgres through `query` (one statement, no parameters). A
 * database the migrator never touched has no drizzle schema yet: everything is pending.
 */
export async function readMigrationState(query: (text: string) => Promise<{ rows: Record<string, unknown>[] }>): Promise<MigrationState> {
  const j = journal()
  const exists = await query(`select to_regclass('drizzle.__drizzle_migrations') is not null as present`)
  if (!exists.rows[0]?.present) return { applied: 0, expected: j.count, pending: j.count > 0 }
  const r = await query(`select count(*)::int as n, coalesce(max(created_at), 0)::text as last from drizzle.__drizzle_migrations`)
  const applied = Number(r.rows[0]?.n ?? 0)
  // drizzle applies every journal entry newer than the last recorded created_at (its `when`).
  const last = Number(r.rows[0]?.last ?? 0)
  return { applied, expected: j.count, pending: last < j.lastWhen }
}

/** For /api/health: the migration state of the open database. PGlite migrates at boot, so it is always current there. */
export async function migrationState(): Promise<MigrationState> {
  if (dbKind() === "pglite") {
    const n = yard.migrations?.applied ?? journalCount()
    return { applied: n, expected: journalCount(), pending: n < journalCount() }
  }
  const pool = (yard as { pgPool?: import("pg").Pool }).pgPool
  if (!pool) {
    const { getPool } = await import("./pg")
    return readMigrationState((t) => getPool().query(t))
  }
  return readMigrationState((t) => pool.query(t))
}

/** Closes the database this process opened (scripts; the server leaves it to process exit). */
export async function closeDb() {
  const close = (yard as { closeDb?: () => Promise<void> }).closeDb
  if (close) await close()
}

async function boot(): Promise<Root> {
  // 1. Any accidental build-time read is loud.
  if (isBuildPhase()) throw new Error("DB access during next build")
  return dbKind() === "postgres" ? bootPostgres() : bootPglite()
}

/** Common to both drivers: the private data directory and its uploads folder. */
function prepareDataDir() {
  const env = getEnv()
  // New files this process creates (database, uploads, secrets) are private to this user.
  try {
    process.umask(0o077)
  } catch {
    /* worker threads can't change the umask; privatiseTree below still applies */
  }
  // The data directory: outside the repo by default, private to this user. Production refuses
  // to open a database other local users can reach; development warns.
  mkdirSync(env.dataDir, { recursive: true, mode: 0o700 })
  if ((statSync(env.dataDir).mode & 0o077) !== 0) {
    const msg = `[yard] ${env.dataDir} is readable by other users; run chmod 700 on it`
    if (!env.dev) throw new Error(`${msg}. Yard won't open its database there in production.`)
    log.warn(msg)
  }
}

/**
 * Postgres (DATABASE_URL). The schema is migrated and seeded by `npm run db:migrate` before a
 * release goes live, never here: boot only checks the database is current and refuses to serve an
 * older schema (health answers 503 and the release rolls back). One server per database: the
 * schedulers and live streams are in-process, so a second server is refused (advisory lock).
 */
async function bootPostgres(): Promise<Root> {
  const started = Date.now()
  const env = getEnv()
  prepareDataDir()
  mkdirSync(env.envDir, { recursive: true, mode: 0o700 })
  mkdirSync(path.join(env.envDir, "uploads"), { recursive: true, mode: 0o700 })
  const loosened = privatiseTree(path.join(env.envDir, "uploads"))
  if (loosened) log.info(`[yard] made ${loosened} upload ${loosened === 1 ? "entry" : "entries"} private (go-rwx)`)

  const { getPool, closePool } = await import("./pg")
  const pool = getPool()
  const { drizzle } = await import("drizzle-orm/node-postgres")
  const root = drizzle(pool, { schema }) as unknown as Root

  const state = await readMigrationState((t) => pool.query(t))
  if (state.pending) throw new MigrationsPendingError(state)

  // The server process (not a script: scripts set the schedulers flag first) holds the one-server lock.
  const server = !yard.schedulers
  if (server) await acquireServerAdvisoryLock(env.databaseUrl!)
  ;(yard as { closeDb?: () => Promise<void> }).closeDb = closePool

  // No SIGTERM handler that ends the pool: Next's standalone server answers SIGTERM by closing the
  // listener and waiting for in-flight requests (realtime/streams.ts ends the live streams so that
  // wait is short), then exits. Ending the pool first would make every one of those requests fail
  // ("Cannot use a pool after calling end"). The sockets close when the process exits, which also
  // releases the server advisory lock. Scripts call closeDb() themselves.

  if (server && !env.seedDemo) {
    const { warnEmptyCatalogue } = await import("./seed")
    await warnEmptyCatalogue(root)
  }
  const { startSchedulers } = await import("../schedulers")
  startSchedulers()

  log.info(`[yard] database ready in ${Date.now() - started} ms (Postgres, ${state.applied} migrations, pool ${env.pgPoolMax})`)
  return root
}

async function bootPglite(): Promise<Root> {
  const started = Date.now()
  const env = getEnv()
  prepareDataDir()

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

  // 5. Open (first boot runs initdb, ~5 s; a reopen takes ~180 ms). Loaded only here, so a
  // Postgres deployment never loads the wasm.
  const { PGlite } = await import("@electric-sql/pglite")
  const client = new PGlite(pgDir)
  await client.waitReady
  const loosened = privatiseTree(env.envDir)
  if (loosened) log.info(`[yard] made ${loosened} database and upload ${loosened === 1 ? "entry" : "entries"} private (go-rwx)`)

  // 6. Drizzle over the watched client, with the runtime schema (no social_tokens).
  const { drizzle } = await import("drizzle-orm/pglite")
  const root = drizzle(watch(client), { schema }) as Root
  ;(yard as { closeDb?: () => Promise<void> }).closeDb = () => client.close()

  // 7. Migrations, in-process only.
  const { migrate } = await import("drizzle-orm/pglite/migrator")
  await migrate(root, { migrationsFolder: migrationsFolder() })
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
