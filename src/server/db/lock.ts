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
