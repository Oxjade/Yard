// M2 project checks (Admin end to end, §9.9), loaded by scripts/db-check.mjs. Each returns { status, name, detail }.
// Read-only: they sign in their own admin sessions and make no decision (sign-in rows are genuine records
// and stay). The live decisions and their restore are in scratchpad/v2-curl/m2.sh.
import { readFileSync } from "node:fs"
import path from "node:path"

export default async function m2({ base }) {
  const out = []
  const add = (ok, name, detail) => out.push({ status: ok === null ? "SKIP" : ok ? "PASS" : "FAIL", name: `M2: ${name}`, detail })
  const json = (cookie) => ({ Origin: base, "X-Yard-Client": "1", "Content-Type": "application/json", ...(cookie ? { cookie } : {}) })
  const signIn = async (account) => {
    const r = await fetch(`${base}/api/auth/demo`, { method: "POST", headers: json(), body: JSON.stringify({ actor: "admin", account }) })
    return r.ok ? r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") : null
  }
  const get = async (cookie, p) => {
    const r = await fetch(`${base}${p}`, { headers: { cookie } })
    return { status: r.status, text: await r.text() }
  }
  const src = (p) => readFileSync(path.join(process.cwd(), p), "utf8")

  // Static: the kit's undo only touches a subject still exactly as the kit's decision left it, and
  // every decision that changes a shared fixture records the state before in its audit meta.
  const undo = src("src/server/moderation/dev-undo.ts")
  add(/const ok = !!f && f\.status === want && f\.decisionReason === a\.reason/.test(undo) && /e\.moderationStatus === to/.test(undo) && /m\.status === "sent" && m\.heldReason === null/.test(undo), "dev undo acts only while the subject is unchanged since the kit's decision")
  const content = src("src/server/moderation/content.ts")
  add((content.match(/fromReviewedAt: iso\(/g) ?? []).length >= 2 && /fromReason: p\.removedReason/.test(content), "place, event and post decisions record the state before (undo can put it back)")
  const charts = src("src/server/moderation/charts.ts")
  // A freeze leaves the brand's flags open: they keep holding it after the freeze ends (C's rule).
  const approve = charts.slice(charts.indexOf("export async function approveChartFreeze"), charts.indexOf("export async function liftChartFreeze"))
  add(!/status: "frozen"/.test(approve) && /openFlags \}/.test(approve) && /status: "open", decidedBy: null/.test(charts), "an approved freeze leaves the brand's flags open; lifting reopens any an earlier build froze")
  const cleanup = src("src/server/moderation/dev-cleanup.ts")
  add(/const isKitView = \(a: AuditRow\) => M_VIEWS\.has\(a\.action\) && \(a\.meta as \{ kit\?: unknown \} \| null\)\?\.kit === true/.test(cleanup) && /isKitView\(a\)/.test(cleanup), "the dev cleanup removes an audited view only when the server marked it as a kit's (meta.kit)")
  add(/priorNotes/.test(cleanup) && /toRestore/.test(cleanup), "the dev cleanup puts back a notification a kit decision only refreshed")
  add(/eq\(chartFlags\.status, "open"\), eq\(chartFlags\.autoAction, HELD\)/.test(charts), "Admin's hold list uses C's rule (open and held_from_charts)")

  const kemi = await signIn("adm_1")
  const aisha = await signIn("adm_3")
  if (!kemi || !aisha) {
    add(null, "live checks", "demo admin sign-in is off")
    return out
  }

  // Charts: every brand a holding flag holds is listed with ALL its holding flags, and each holding
  // flag names the others (so the page can say which flags block which brand).
  const f = await get(aisha, "/api/admin/charts/flags?status=all")
  if (f.status === 200) {
    const d = JSON.parse(f.text)
    const holding = d.items.filter((x) => x.status === "open" && x.autoAction === "held_from_charts")
    const byBrand = new Map()
    for (const x of holding) byBrand.set(x.brand.id, [...(byBrand.get(x.brand.id) ?? []), x.id])
    const holdsOk = [...byBrand].every(([b, ids]) => {
      const h = d.holds.find((y) => y.brand.id === b)
      return h && h.flags.length === ids.length && ids.every((id) => h.flags.some((g) => g.id === id))
    })
    add(holdsOk && d.holds.length === byBrand.size, "every held brand is listed with every flag holding it", `${d.holds.length} held: ${d.holds.map((h) => `${h.brand.name} (${h.flags.length})`).join(", ") || "none"}`)
    add(
      holding.every((x) => x.hold.holding && x.hold.others.length === byBrand.get(x.brand.id).length - 1),
      "each holding flag names the brand's other holding flags",
    )
    add(d.items.filter((x) => x.detector === "coordinated_ring").every((x) => x.ringPeers.every((b) => b.name && !b.name.startsWith("b_"))), "ring flags name the other brands the ring followed")
    const stuck = d.items.filter((x) => x.status === "frozen" && x.freeze?.status !== "active")
    add(stuck.length === 0, "no flag is left frozen without a freeze in force (it would hold nothing and couldn't be decided)", stuck.map((x) => `${x.brand.name} ${x.detector}`).join(", ") || "none")
  } else add(false, "charts flags", `HTTP ${f.status}`)

  const o = await get(aisha, "/api/admin/charts/overview")
  if (o.status === 200) {
    const d = JSON.parse(o.text)
    add((d.proxyHops > 0) === (d.ipSignal === "available") && d.orderSignals === "not_connected", "overview states the IP signal (with the hops) and that order signals aren't connected", `ipSignal ${d.ipSignal}, hops ${d.proxyHops}`)
  } else add(false, "charts overview", `HTTP ${o.status}`)

  // Delivery: exceptions carry the brand's notes and a held count that matches them.
  const ex = await get(kemi, "/api/admin/delivery?tab=exceptions")
  if (ex.status === 200) {
    const d = JSON.parse(ex.text)
    add(d.items.every((i) => Array.isArray(i.brandNotes) && i.heldNotes === i.brandNotes.filter((n) => n.held).length), "exceptions carry brand notes with a matching held count", `${d.items.length} exceptions`)
  } else add(false, "delivery exceptions", `HTTP ${ex.status}`)

  // No token fields anywhere in Admin's reads.
  let leaked = 0
  for (const p of ["queues/counts", "messages?tab=held", "content?tab=integrations", "charts/flags?status=all", "delivery?tab=exceptions", "abuse", "audit?actorKind=all&limit=200"]) {
    const r = await get(kemi, `/api/admin/${p}`)
    leaked += (r.text.match(/access_token|refresh_token|token_hash|_enc"/g) ?? []).length
  }
  add(leaked === 0, "no token field in any admin read", `${leaked} found`)

  // Nothing of M's kits is left behind (dry run: reads only).
  const dry = await fetch(`${base}/api/admin/dev/cleanup`, { method: "POST", headers: json(kemi), body: JSON.stringify({ dryRun: true }) })
  if (dry.status === 404) add(null, "kit leftovers", "dev cleanup is off (production)")
  else {
    const d = await dry.json()
    const left = d.conversations.length + d.media + d.reports.length + d.notifications + d.restrictions + d.abuseAlerts + d.chartSignals
    add(left === 0, "no M test-shopper data left (u_t_m1, u_t_m2)", left ? JSON.stringify(d).slice(0, 200) : "clean")
  }
  for (const c of [kemi, aisha]) await fetch(`${base}/api/auth/demo?actor=admin`, { method: "DELETE", headers: json(c) })
  return out
}
