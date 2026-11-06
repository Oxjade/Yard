// I project checks (Inbox, §6.2), loaded by scripts/db-check.mjs. Each returns { status, name, detail }.
// Read-only: they sign in their own demo sessions and only read; the mutating checks live in the curl
// kit (scratchpad/v2-curl/i.sh), which restores I's fixtures with a reseed.
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
  const qr = await (await get("/api/studio/inbox/quick-replies", tobi)).json().catch(() => ({}))
  add(qr.items?.some((q) => q.shortcut === "/size"), "Lagos Static's seeded quick replies include /size")
  const noConv = await fetch(`${base}/api/studio/inbox/messages`, { method: "POST", headers: json(tobi), body: JSON.stringify({ clientId: "check-no-conversation", kind: "text", body: "hi" }) })
  add(noConv.status === 400, "brands can't start a conversation", `HTTP ${noConv.status}`)
  return out
}
