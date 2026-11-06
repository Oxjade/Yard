#!/usr/bin/env node
// npm run db:reset — deletes ${dataDir}/development/pg and …/uploads (§1.2). Refuses while a dev
// server holds the lock. Secrets are kept, so demo sessions end but keys stay stable.
import { rmSync } from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import { homedir } from "node:os"
import { readFileSync } from "node:fs"

// The data directory rule of src/server/env.ts (§1.1), repeated here so the script runs in plain Node.
function dataDir(repoRoot = process.cwd()) {
  const set = process.env.YARD_DATA_DIR?.trim()
  if (set) return path.resolve(set)
  const abs = path.resolve(repoRoot)
  return path.join(homedir(), ".yard", `${path.basename(abs)}-${createHash("sha256").update(abs).digest("hex").slice(0, 8)}`)
}

function lockPid(dir, env = "development") {
  try {
    const pid = Number(readFileSync(path.join(dir, `${env}.lock`), "utf8").trim())
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code === "EPERM"
  }
}

const dir = dataDir()
const pid = lockPid(dir, "development")
if (pid && alive(pid)) {
  console.error(`Refusing: a Yard dev server (pid ${pid}) is using ${path.join(dir, "development")}. Stop it first.`)
  process.exit(1)
}
for (const sub of ["pg", "uploads"]) rmSync(path.join(dir, "development", sub), { recursive: true, force: true })
console.log(`Reset ${path.join(dir, "development")} (pg and uploads deleted). The next \`npm run dev\` re-creates and reseeds it.`)
