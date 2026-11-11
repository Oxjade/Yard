import "server-only"
import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync, writeSync } from "node:fs"
import path from "node:path"

/**
 * PGlite has no lock of its own, so two processes on one data directory would corrupt it.
 * `${dataDir}/${NODE_ENV}.lock` holds the owning pid (§1.3 step 3).
 */
export function lockPath(dataDir: string, nodeEnv: string) {
  return path.join(dataDir, `${nodeEnv}.lock`)
}

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    // EPERM: the process exists but belongs to someone else.
    return (e as NodeJS.ErrnoException).code === "EPERM"
  }
}

export function acquireLock(dataDir: string, nodeEnv: string) {
  const file = lockPath(dataDir, nodeEnv)
  try {
    const fd = openSync(file, "wx", 0o600)
    writeSync(fd, String(process.pid))
    closeSync(fd)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e
    const pid = Number(readFileSync(file, "utf8").trim())
    if (pid === process.pid) return file // an HMR re-evaluation in this same process
    if (Number.isInteger(pid) && pid > 0 && alive(pid)) {
      throw new Error(`Another Yard server (pid ${pid}) is using ${path.join(dataDir, nodeEnv)}. Stop it first.`)
    }
    writeFileSync(file, String(process.pid), { mode: 0o600 }) // stale lock
  }
  process.once("exit", () => releaseLock(file))
  return file
}

export function releaseLock(file: string) {
  try {
    // Only our own lock: never remove one a newer process took over.
    if (Number(readFileSync(file, "utf8").trim()) === process.pid) unlinkSync(file)
  } catch {
    /* already gone */
  }
}

/**
 * Postgres (DATABASE_URL): one Yard server per database, held as a session advisory lock on a
 * dedicated connection for the life of the process. The schedulers, live streams and rate limits
 * are in-process (single instance by design), so a second server on the same database is refused
 * rather than doubling every job. A restart is stop-then-start, so the old process's lock is gone
 * (its connection closed) before the new one asks. If the connection drops, the lock is retaken;
 * when another server took it meanwhile, this process stops (systemd restarts it, and it is
 * refused again while the other one runs).
 */
export const SERVER_LOCK_KEY = 0x59617264 // "Yard"
/** db:migrate's lock (separate from the server's, so a migration can run beside the live server). */
export const MIGRATE_LOCK_KEY = 0x59617267

type LockState = { serverLock?: { client: import("pg").Client; url: string } }

export async function acquireServerAdvisoryLock(url: string): Promise<void> {
  const { yard } = await import("../state")
  const s = yard as LockState
  if (s.serverLock?.url === url) return // this process already holds it (an HMR re-boot)
  const { newClient } = await import("./pg")
  const { log } = await import("../log")
  const client = newClient({ statementTimeoutMs: 0, applicationName: "yard-server-lock" })
  await client.connect()
  const r = await client.query<{ ok: boolean }>("select pg_try_advisory_lock($1) as ok", [SERVER_LOCK_KEY])
  if (!r.rows[0]?.ok) {
    await client.end().catch(() => {})
    throw new Error("Another Yard server is using this database. Stop it first (one server per database: jobs and live updates run in-process).")
  }
  s.serverLock = { client, url }
  if (!watchingSignals) {
    watchingSignals = true
    // Registered with the pool's close handler (client.ts), which re-raises the signal once done.
    for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, () => (shuttingDown = true))
  }
  client.on("error", (e) => log.error("[yard] server lock connection error", e))
  client.on("end", () => {
    if (s.serverLock?.client !== client) return
    s.serverLock = undefined
    if (shuttingDown) return
    log.warn("[yard] lost the server lock connection; taking the lock again")
    void retake(url, 0)
  })
}

let shuttingDown = false
let watchingSignals = false

async function retake(url: string, attempt: number): Promise<void> {
  const { log } = await import("../log")
  try {
    await acquireServerAdvisoryLock(url)
    log.info("[yard] server lock taken again")
  } catch (e) {
    if (e instanceof Error && /Another Yard server/.test(e.message)) {
      log.error("[yard] another server took this database's lock while the connection was down; stopping so only one runs")
      process.exit(1)
    }
    if (attempt >= 30) {
      log.error("[yard] couldn't retake the server lock for 5 minutes; stopping")
      process.exit(1)
    }
    setTimeout(() => void retake(url, attempt + 1), 10_000).unref()
  }
}

/** For db-check and the dev selftest: whether this process holds the Postgres server lock. */
export async function serverLockHeld(): Promise<boolean> {
  const { yard } = await import("../state")
  return !!(yard as LockState).serverLock
}
