// I project checks (Inbox, §6.2), loaded by scripts/db-check.mjs. Each returns { status, name, detail }.
// Read-only: they sign in their own demo sessions and only read; the mutating checks live in the curl
// kit (scratchpad/v2-curl/i.sh), which creates I's test conversations with POST /api/inbox/dev/fixtures
// and removes them (and everything else u_t_i1..3 left) at its end.
import { readFileSync } from "node:fs"
import path from "node:path"

export default async function i({ base }) {
  const out = []
  const add = (ok, name, detail) => out.push({ status: ok === null ? "SKIP" : ok ? "PASS" : "FAIL", name: `I: ${name}`, detail })
  const json = (cookie) => ({ Origin: base, "X-Yard-Client": "1", "Content-Type": "application/json", ...(cookie ? { cookie } : {}) })
  const signIn = async (actor, account) => {
    const r = await fetch(`${base}/api/auth/demo`, { method: "POST", headers: json(), body: JSON.stringify({ actor, account }) })
    return r.ok ? r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") : null
  }
  const read = (p) => readFileSync(path.join(process.cwd(), p), "utf8")

  // Static: the send path runs in one transaction; held messages never notify; search binds its text.
  const service = read("src/server/inbox/service.ts")
  const search = read("src/server/inbox/search.ts")
  add(/websearch_to_tsquery\('simple', \$\{text\}\)/.test(search) && /escape '\\\\'/.test(search), "search uses websearch_to_tsquery with a bound parameter and an escaped ILIKE")
  add(/Held \(§6\.2 rule 10\)[\s\S]{0,200}publishMessage\(c, m\.id, "message\.created", \["customer"\]\)/.test(service), "a held shopper message is published to the sender only")
  add(!/notify\([^)]*body/.test(service), "notifications never carry message text (template vars only)")
  add(/IMPL: string = "I-/.test(read("src/server/inbox/index.ts")), "inbox contract implemented (IMPL)")
  add(!/["'`]cv_t_/.test(read("src/server/db/seed/inbox.ts")), "the inbox seed holds sample conversations only (test conversations come from the dev fixtures endpoint)")
  // Idempotency is scoped to the sender, and replays only ever return what that side may see (§6.2).
  add(/existingByClientId\(conversationId: string, clientId: string, sender: \{ side: Side; userId: string \}\)/.test(service) && /if \(!mine\) throw conflict\(/.test(service), "a clientId the other side used is a 409, never their message")
  add(/where\(and\(eq\(messages\.id, messageId\), visibleTo\(side\)\)\)/.test(read("src/server/inbox/dto.ts")), "messageDtoFor only returns messages the side may see")
  add(!/clientId: `seed-/.test(read("src/server/db/seed/inbox.ts")), "seeded clientIds are random, not derived from message ids")
  // Spam rules see normalised text and stored bodies lose bidi and zero-width controls (§5.2).
  const spam = read("src/server/inbox/spam.ts")
  add(/export function scoringText/.test(spam) && /findUrls\(scoringText\(text\)\)/.test(spam) && /const n = scoringText\(body\)/.test(spam), "URL, phrase and duplicate rules run on normalised text")
  add(/const text = cleanBody\(body \?\? ""\)/.test(service), "stored bodies go through cleanBody (no bidi or zero-width controls)")
  // Typing is limited before any database read (§4.4).
  for (const f of ["src/app/api/inbox/conversations/[id]/typing/route.ts", "src/app/api/studio/inbox/conversations/[id]/typing/route.ts"]) {
    const src = read(f)
    const limit = src.search(/typingAllowed\(`/)
    const load = src.search(/load(Shopper|Brand)Conversation\((actor|brandId)/)
    add(limit > -1 && load > -1 && limit < load, `typing limits run before the conversation loads (${f.includes("studio") ? "Studio" : "shopper"})`)
  }

  const ada = await signIn("shopper", "u_ada")
  const tobi = await signIn("brand", "u_b_tobi")
  const minji = await signIn("brand", "u_b_minji")
  if (!ada || !tobi || !minji) {
    add(null, "live checks", "demo sign-in is off")
    return out
  }
  const get = (p, cookie) => fetch(`${base}${p}`, { headers: { cookie } })

  const list = await get("/api/inbox/conversations", ada)
  const body = await list.json().catch(() => ({}))
  add(list.ok && body.items?.some((c) => c.id === "cv_seed_ada_ls" && c.sample), "Ada's list has the seeded Lagos Static conversation (sample)", `HTTP ${list.status}`)
  const thread = await (await get("/api/inbox/conversations/cv_seed_ada_ls/messages", ada)).json().catch(() => ({}))
  const att = thread.messages?.flatMap((m) => m.attachments) ?? []
  add(att.some((a) => a.src === "/api/media/med_seed_ada_fit?as=shopper"), "the private fit photo is served through /api/media with as=shopper")
  add(!JSON.stringify(thread).includes('"/media/'), "no /media/ path in the thread DTO")
  const iso = await get("/api/studio/inbox/conversations/cv_seed_ada_ls", minji)
  add(iso.status === 404, "Min-ji can't open Lagos Static's conversation", `HTTP ${iso.status}`)
  const studio = await (await get("/api/studio/inbox/conversations?filter=open", tobi)).json().catch(() => ({}))
  add(!!studio.counts && typeof studio.counts.unread === "number", "Studio list returns counts per filter", JSON.stringify(studio.counts))
  const unread = await (await get("/api/studio/inbox/unread", tobi)).json().catch(() => ({}))
  add(unread.conversations === studio.counts?.unread, "Studio unread equals the Unread tab", `${unread.conversations} vs ${studio.counts?.unread}`)
  const held = await (await get("/api/studio/inbox/conversations/cv_seed_u7_ls/messages", tobi)).json().catch(() => ({}))
  add(Array.isArray(held.messages) && held.messages.every((m) => m.status !== "held"), "Tobi never sees u_7's held message")
  const adaList = body.items ?? []
  add(adaList.length > 0 && adaList.every((c) => c.spamState === "none"), "a shopper's summaries never carry spamState")
  const qr = await (await get("/api/studio/inbox/quick-replies", tobi)).json().catch(() => ({}))
  add(qr.items?.some((q) => q.shortcut === "/size"), "Lagos Static's seeded quick replies include /size")
  // Test-data hygiene (§9.0): Lagos Static's inbox shows only the seeded samples between kit runs.
  const names = []
  for (const f of ["open", "unread", "resolved", "spam", "blocked"]) {
    const page = await (await get(`/api/studio/inbox/conversations?filter=${f}`, tobi)).json().catch(() => ({}))
    for (const c of page.items ?? []) if (!c.sample) names.push(`${c.customer?.name ?? c.id} (${f})`)
  }
  add(names.length === 0, "Lagos Static's inbox lists only sample conversations (no test shoppers left by a kit)", names.slice(0, 6).join(", ") || "all sample")
  const noConv = await fetch(`${base}/api/studio/inbox/messages`, { method: "POST", headers: json(tobi), body: JSON.stringify({ clientId: "check-no-conversation", kind: "text", body: "hi" }) })
  add(noConv.status === 400, "brands can't start a conversation", `HTTP ${noConv.status}`)
  return out
}

// Run on its own (`node scripts/checks/<name>.mjs`): db-check signs in a demo admin and runs just this file.
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const { spawnSync } = await import("node:child_process")
  const root = path.resolve(import.meta.dirname, "..", "..")
  process.exit(spawnSync(process.execPath, [path.join(root, "scripts", "db-check.mjs"), path.basename(import.meta.filename, ".mjs")], { cwd: root, stdio: "inherit" }).status ?? 1)
}
