#!/usr/bin/env node
// npm run db:check — the v2 health check (§1.2, §9.0):
//   node scripts/db-check.mjs lock     the data dir, its mode and the lock's pid (no server needed)
//   node scripts/db-check.mjs fix-modes  removes group/other access under the data dir (chmod go-rwx)
//   node scripts/db-check.mjs          the above, plus the running server's migrations and seed
//                                      versions (GET /api/dev/selftest as a demo admin), then every
//                                      project check in scripts/checks/*.mjs (PASS / FAIL / SKIP)
//   node scripts/db-check.mjs f2 s     the same, running only the named project checks; this is what
//                                      `node scripts/checks/f2.mjs` hands over to when run on its own
import { chmodSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
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

const base = process.env.YARD_CHECK_URL ?? "http://localhost:3000"
const dir = dataDir()
const results = []
const out = (status, name, detail = "") => {
  results.push({ status, name })
  console.log(`${status.padEnd(4)} ${name}${detail ? `  ${detail}` : ""}`)
}
const mode = (p) => {
  try {
    return (statSync(p).mode & 0o777).toString(8)
  } catch {
    return null
  }
}

console.log(`data dir   ${dir}`)
const m = mode(dir)
out(m === "700" ? "PASS" : m ? "FAIL" : "SKIP", "data dir is private (700)", m ? `mode ${m}${m !== "700" ? ` — run chmod 700 ${dir}` : ""}` : "not created yet")
const s = mode(path.join(dir, "development", "secrets.json"))
out(s === "600" ? "PASS" : s ? "FAIL" : "SKIP", "development secrets are private (600)", s ? `mode ${s}` : "not created yet")
// Entries under the data dir that other local users can reach (PGlite creates files 0666).
function looseEntries(root) {
  const found = { writable: 0, readable: 0, paths: [] }
  const walk = (p) => {
    let st
    try {
      st = statSync(p)
    } catch {
      return
    }
    if (st.mode & 0o077) {
      if (st.mode & 0o022) found.writable++
      else found.readable++
      found.paths.push(p)
    }
    if (st.isDirectory()) for (const name of readdirSync(p)) walk(path.join(p, name))
  }
  walk(root)
  return found
}
if (process.argv[2] === "fix-modes") {
  const loose = looseEntries(dir)
  for (const p of loose.paths) chmodSync(p, statSync(p).mode & 0o700)
  console.log(`made ${loose.paths.length} entries under ${dir} private (go-rwx)`)
  process.exit(0)
}
{
  const loose = looseEntries(dir)
  out(loose.paths.length ? "FAIL" : "PASS", "nothing under the data dir is open to other users", loose.paths.length ? `${loose.writable} writable by group or others, ${loose.readable} readable — run node scripts/db-check.mjs fix-modes` : "")
}
const pid = lockPid(dir, "development")
console.log(`lock       ${path.join(dir, "development.lock")}: ${pid ? `pid ${pid} (${alive(pid) ? "running" : "stale"})` : "none"}`)
if (process.argv[2] === "lock") process.exit(0)

// A demo admin cookie for the dev endpoints.
async function adminCookie() {
  const res = await fetch(`${base}/api/auth/demo`, {
    method: "POST",
    headers: { Origin: base, "X-Yard-Client": "1", "Content-Type": "application/json" },
    body: JSON.stringify({ actor: "admin", account: "adm_1" }),
  })
  if (!res.ok) throw new Error(`demo admin sign-in: ${res.status}`)
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ")
}

let cookie = ""
try {
  cookie = await adminCookie()
  const st = await (await fetch(`${base}/api/dev/selftest`, { headers: { cookie } })).json()
  out(st.lockPid === st.pid ? "PASS" : "FAIL", "the server holds the lock", `server pid ${st.pid}, lock pid ${st.lockPid}`)
  out(st.migrations.journal === st.migrations.applied ? "PASS" : "FAIL", "migrations applied", `${st.migrations.applied}/${st.migrations.journal}`)
  const expected = ["seed:reference", "seed:people", "seed:brands", "seed:catalog", "seed:drops", "seed:orders", "seed:around", "seed:shipping", "seed:delivery", "seed:social", "seed:inbox", "seed:safety", "seed:charts"]
  out(JSON.stringify(st.seeds.map((x) => x.key)) === JSON.stringify(expected) ? "PASS" : "FAIL", "seed order", st.seeds.map((x) => x.key.replace("seed:", "")).join(" → "))
  for (const x of st.seeds) {
    if (x.version === 0) console.log(`     ${x.key.padEnd(14)} stub (version 0; its cluster replaces it)`)
    else out(x.recorded === x.version ? "PASS" : "FAIL", `${x.key} version recorded`, `module v${x.version}, recorded ${x.recorded ?? "none"}${x.requires.length ? `, requires ${x.requires.join(", ")}` : ""}`)
  }
} catch (e) {
  out("FAIL", "server status", `${base} didn't answer as expected (${e.message}). Is \`npm run dev\` running?`)
}

// Every cluster's project checks.
const checksDir = path.join(process.cwd(), "scripts", "checks")
const only = process.argv.slice(2)
const files = readdirSync(checksDir).filter((x) => x.endsWith(".mjs") && (!only.length || only.includes(x.replace(".mjs", ""))))
for (const name of only) if (!files.includes(`${name}.mjs`)) out("FAIL", `${name}`, `no scripts/checks/${name}.mjs`)
for (const f of files.sort()) {
  try {
    const mod = await import(pathToFileURL(path.join(checksDir, f)).href)
    const list = await mod.default({ base, cookie, dataDir: dir })
    for (const r of list ?? []) out(r.status, `${f.replace(".mjs", "")}: ${r.name}`, r.detail ?? "")
  } catch (e) {
    out("FAIL", `${f}`, e.message)
  }
}

const failed = results.filter((r) => r.status === "FAIL").length
const skipped = results.filter((r) => r.status === "SKIP").length
console.log(`\n${results.length - failed - skipped} passed, ${failed} failed, ${skipped} skipped`)
process.exit(failed ? 1 : 0)
