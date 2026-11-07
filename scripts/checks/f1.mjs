// F1 project checks, loaded by scripts/db-check.mjs. Each returns { status, name, detail }.
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

export default async function f1({ base, cookie }) {
  const out = []
  const add = (ok, name, detail) => out.push({ status: ok === null ? "SKIP" : ok ? "PASS" : "FAIL", name, detail })
  const json = (headers = {}) => ({ Origin: base, "X-Yard-Client": "1", "Content-Type": "application/json", ...headers })

  // The runtime schema object never exports social_tokens (§5.5).
  const idx = readFileSync(path.join(process.cwd(), "src/server/db/schema/index.ts"), "utf8")
  add(!/social-tokens/.test(idx.replace(/\/\*[\s\S]*?\*\//g, "")), "runtime schema leaves out social_tokens")
  add(existsSync(path.join(process.cwd(), "drizzle/0001_custom_views_and_indexes.sql")), "custom migration present")

  const session = await (await fetch(`${base}/api/session`)).json()
  add(session && "demoAuth" in session && session.shopper === null, "anonymous /api/session shape", JSON.stringify(session.demoAuth))

  const noOrigin = await fetch(`${base}/api/auth/demo`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actor: "shopper", account: "u_t_f1" }) })
  add(noOrigin.status === 403 && (await noOrigin.json()).error.code === "csrf", "POST without Origin is 403 csrf")

  const r = await fetch(`${base}/api/auth/demo`, { method: "POST", headers: json(), body: JSON.stringify({ actor: "shopper", account: "u_t_f1" }) })
  const c = r.headers.getSetCookie().map((x) => x.split(";")[0]).join("; ")
  const me = await (await fetch(`${base}/api/session`, { headers: { cookie: c } })).json()
  add(r.ok && me.shopper?.id === "u_t_f1" && !JSON.stringify(me).match(/token/i), "demo shopper sign-in, no token fields")

  if (cookie) {
    const st = await fetch(`${base}/api/dev/selftest/tx`, { method: "POST", headers: json({ cookie }) })
    const body = await st.json()
    add(body.committed === 3 && body.rolledBackPublished === 0 && body.adminStreamEvents === 1 && body.ms < 2000, "transaction self-test", JSON.stringify(body))
  } else add(null, "transaction self-test", "no admin cookie")
  return out
}

// Run on its own (`node scripts/checks/<name>.mjs`): db-check signs in a demo admin and runs just this file.
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const { spawnSync } = await import("node:child_process")
  const root = path.resolve(import.meta.dirname, "..", "..")
  process.exit(spawnSync(process.execPath, [path.join(root, "scripts", "db-check.mjs"), path.basename(import.meta.filename, ".mjs")], { cwd: root, stdio: "inherit" }).status ?? 1)
}
