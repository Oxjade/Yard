#!/usr/bin/env node
// npm run start:demo — a LOCAL DEMO of the production build, never a deployment (README).
// Runs `next build`, then `next start -p 3001 -H 127.0.0.1` with NODE_ENV=production,
// YARD_DEMO_AUTH=1 and YARD_PUBLIC_URL=http://localhost:3001. It listens on this machine only:
// demo sign-in has no passwords, so exposing it takes an explicit YARD_DEMO_HOST=0.0.0.0.
// Production secrets are generated once into ${dataDir}/production/demo-secrets.json (mode 0600)
// and passed as env vars.
import { spawnSync, spawn } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { homedir } from "node:os"

// The data directory rule of src/server/env.ts (§1.1), repeated here so the script runs in plain Node.
function dataDir(repoRoot = process.cwd()) {
  const set = process.env.YARD_DATA_DIR?.trim()
  if (set) return path.resolve(set)
  const abs = path.resolve(repoRoot)
  return path.join(homedir(), ".yard", `${path.basename(abs)}-${createHash("sha256").update(abs).digest("hex").slice(0, 8)}`)
}

const dir = dataDir()
const prod = path.join(dir, "production")
mkdirSync(prod, { recursive: true, mode: 0o700 })
const file = path.join(prod, "demo-secrets.json")
if (!existsSync(file)) {
  writeFileSync(file, JSON.stringify({ YARD_SESSION_SECRET: randomBytes(32).toString("base64url"), YARD_ENCRYPTION_KEY: randomBytes(32).toString("base64") }, null, 2) + "\n", { mode: 0o600 })
  chmodSync(file, 0o600)
}
const secrets = JSON.parse(readFileSync(file, "utf8"))
const port = process.env.PORT ?? "3001"
const host = process.env.YARD_DEMO_HOST?.trim() || "127.0.0.1"
const env = { ...process.env, ...secrets, NODE_ENV: "production", YARD_DEMO_AUTH: "1", YARD_PUBLIC_URL: process.env.YARD_PUBLIC_URL ?? `http://localhost:${port}` }

if (!process.argv.includes("--no-build")) {
  const b = spawnSync("npx", ["next", "build"], { stdio: "inherit", env })
  if (b.status !== 0) process.exit(b.status ?? 1)
}
const where = host === "127.0.0.1" || host === "localhost" ? "this machine only" : `${host} — reachable from your network`
console.log(`\nLocal demo on http://localhost:${port} (${where}) — demo sign-in is ON (no passwords). Not for deployment.\n`)
const child = spawn("npx", ["next", "start", "-p", port, "-H", host], { stdio: "inherit", env })
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig))
child.on("exit", (code) => process.exit(code ?? 0))
