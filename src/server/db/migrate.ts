import "server-only"
import { getEnv } from "../env"
import { yard } from "../state"
import { migrationsFolder, readMigrationState, type MigrationState, type Root } from "./client"
import { MIGRATE_LOCK_KEY } from "./lock"
import * as schema from "./schema"

/**
 * `npm run db:migrate` on Postgres (hosting plan A.4): the deploy step that brings the database up
 * to this build's schema BEFORE the release goes live, so servers never migrate at boot or race
 * each other. Under an advisory lock, so two runs (two deploys, a deploy and a restore) wait for
 * each other instead of migrating at once; the second finds nothing to do. Then the seeds:
 * reference data (categories, holidays) always, demo fixtures only when YARD_SEED_DEMO says so
 * (never in production). drizzle runs the pending migrations in one transaction, so a failing
 * migration leaves the database as it was.
 */
export type MigrateResult = {
  before: MigrationState
  after: MigrationState
  seeds: { ran: string[]; failed: string[]; waiting: string[] } | null
  ms: number
}

export async function migrateDatabase(opts: { checkOnly?: boolean; lockWaitSeconds?: number } = {}): Promise<MigrateResult> {
  const started = Date.now()
  const env = getEnv()
  if (!env.databaseUrl) throw new Error("DATABASE_URL is not set: PGlite migrates and seeds when the server boots, so there is nothing to run.")
  // This process never runs the background jobs (only the server does).
  yard.schedulers = true
  const { newClient } = await import("./pg")
  const client = newClient({ statementTimeoutMs: 0, applicationName: "yard-migrate" })
  await client.connect()
  try {
    const query = (t: string) => client.query(t)
    if (opts.checkOnly) {
      const s = await readMigrationState(query)
      return { before: s, after: s, seeds: null, ms: Date.now() - started }
    }
    // lock_timeout bounds the wait for another migrate (advisory locks honour it).
    await client.query(`set lock_timeout = '${Math.max(1, Math.min(600, opts.lockWaitSeconds ?? 120))}s'`)
    await client.query("select pg_advisory_lock($1)", [MIGRATE_LOCK_KEY])
    await client.query("set lock_timeout = '60s'")
    try {
      const before = await readMigrationState(query)
      const { drizzle } = await import("drizzle-orm/node-postgres")
      const { migrate } = await import("drizzle-orm/node-postgres/migrator")
      const root = drizzle(client, { schema })
      await migrate(root, { migrationsFolder: migrationsFolder() })
      const after = await readMigrationState(query)
      const { runSeeds } = await import("./seed")
      const seeds = await runSeeds(root as unknown as Root)
      return { before, after, seeds, ms: Date.now() - started }
    } finally {
      await client.query("select pg_advisory_unlock($1)", [MIGRATE_LOCK_KEY]).catch(() => {})
    }
  } finally {
    await client.end().catch(() => {})
    // Anything a seed opened through db() (the pool) closes too, so the process can exit.
    const { closePool } = await import("./pg")
    await closePool()
  }
}
