// M project checks (Admin, §8), loaded by scripts/db-check.mjs. Each returns { status, name, detail }.
// Read-only apart from audited views: they sign in their own admin sessions and change no queue state.
import { readFileSync } from "node:fs"
import path from "node:path"

export default async function m({ base }) {
  const out = []
  const add = (ok, name, detail) => out.push({ status: ok === null ? "SKIP" : ok ? "PASS" : "FAIL", name: `M: ${name}`, detail })
  const json = (cookie) => ({ Origin: base, "X-Yard-Client": "1", "Content-Type": "application/json", ...(cookie ? { cookie } : {}) })
  const signIn = async (account) => {
    const r = await fetch(`${base}/api/auth/demo`, { method: "POST", headers: json(), body: JSON.stringify({ actor: "admin", account }) })
    return r.ok ? r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") : null
  }

  // Static: the decision map is kebab-case and every key has a handler and a strict body.
  const index = readFileSync(path.join(process.cwd(), "src/server/moderation/index.ts"), "utf8")
  const contract = readFileSync(path.join(process.cwd(), "src/lib/api/contracts/admin.ts"), "utf8")
  const keys = [...index.matchAll(/^\s+"([a-z-]+)": \{ handler: "(\w+)"/gm)].map((x) => x[1])
  add(keys.length >= 26 && keys.every((k) => /^[a-z]+(-[a-z]+)*$/.test(k)), "decision keys are kebab-case", `${keys.length} actions`)
  add(keys.every((k) => contract.includes(`"${k}":`)), "every decision has a body schema in contracts/admin.ts")
  add(!/social-tokens|socialTokens/.test(readFileSync(path.join(process.cwd(), "src/server/moderation/content.ts"), "utf8")), "moderation never imports the token table")

  const aisha = await signIn("adm_3")
  const ngozi = await signIn("adm_5")
  if (!aisha || !ngozi) {
    add(null, "live checks", "demo admin sign-in is off")
    return out
  }
  const get = (p, cookie) => fetch(`${base}${p}`, { headers: { cookie } })

  const flags = await get("/api/admin/charts/flags", ngozi)
  add(flags.status === 403, "Support can't read chart flags", `HTTP ${flags.status}`)
  const rm = await fetch(`${base}/api/admin/decisions/remove-message`, { method: "POST", headers: json(ngozi), body: JSON.stringify({ id: "msg_x", reason: "Permission check only" }) })
  const rmBody = await rm.json().catch(() => ({}))
  add(rm.status === 403 && rmBody?.error?.code === "forbidden", "Support remove-message is 403 forbidden", `HTTP ${rm.status}`)
  const unknown = await fetch(`${base}/api/admin/decisions/no-such-action`, { method: "POST", headers: json(aisha), body: "{}" })
  add(unknown.status === 404, "unknown decision is 404", `HTTP ${unknown.status}`)

  let bodies = 0
  for (const tab of ["reported", "held", "spam", "closed"]) {
    const r = await (await get(`/api/admin/messages?tab=${tab}`, aisha)).json()
    bodies += JSON.stringify(r).includes('"body"') ? 1 : 0
  }
  add(bodies === 0, "message queue rows carry no body", `${bodies} tabs with a body key`)

  const ev = await get("/api/admin/messages/rp_seed_msg/evidence", aisha)
  if (ev.status === 404) add(null, "evidence is POST only", "rp_seed_msg isn't seeded yet")
  else add(ev.status === 405, "evidence is POST only (GET 405)", `HTTP ${ev.status}`)

  let tokens = 0
  for (const p of ["/api/admin/content?tab=integrations", "/api/admin/content?tab=posts", "/api/admin/abuse", "/api/admin/audit?actorKind=all&limit=200", "/api/admin/charts/overview"]) {
    const text = await (await get(p, aisha)).text()
    tokens += (text.match(/access_token|refresh_token|token_hash/g) ?? []).length
  }
  add(tokens === 0, "no admin response carries a token field", `${tokens} matches`)

  const seed = await (await get("/api/admin/audit?subjectId=rp_seed_msg", aisha)).json()
  add(Array.isArray(seed.items), "audit feed answers for a subject", `${seed.items?.length ?? 0} rows for rp_seed_msg`)
  return out
}
