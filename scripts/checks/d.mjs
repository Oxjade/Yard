// Cluster D project checks (delivery estimates), loaded by scripts/db-check.mjs. Each returns { status, name, detail }.
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

export default async function d({ base, cookie }) {
  const out = []
  // This check's start (second precision, a little early): its cleanup sweeps u_t_d1 checkouts from here on only.
  const started = new Date(Date.now() - 2000).toISOString()
  const add = (ok, name, detail) => out.push({ status: ok === null ? "SKIP" : ok ? "PASS" : "FAIL", name, detail })
  const headers = (extra = {}) => ({ Origin: base, "X-Yard-Client": "1", "Content-Type": "application/json", ...extra })
  const read = (p) => readFileSync(path.join(process.cwd(), p), "utf8")

  // The engine is plain Node (§1.8): no server-only, no @/ aliases.
  for (const f of ["calendar", "estimate", "format", "types"]) {
    const src = read(`src/lib/shipping/${f}.ts`)
    add(!/import\s+["']server-only["']|from\s+["']@\//.test(src), `lib/shipping/${f}.ts is plain Node`)
  }
  add(existsSync(path.join(process.cwd(), "src/lib/shipping/calendar.test.ts")) && existsSync(path.join(process.cwd(), "src/lib/shipping/estimate.test.ts")), "calendar and estimate unit tests present (npm test)")
  add(/IMPL: string = "D-/.test(read("src/server/shipping/index.ts")), "shipping contract implemented (IMPL)")

  // The estimate: a range, business days, never guaranteed.
  const est = await (await fetch(`${base}/api/shipping/estimate?product=p_third_mainland_tee&to=NG`)).json().catch(() => null)
  const opt = est?.options?.find((o) => o.available)
  add(!!opt && opt.estimate.arrivalFrom <= opt.estimate.arrivalTo && opt.estimate.guaranteed === false && opt.guaranteed === false && !JSON.stringify(est).includes('"guaranteed":true'), "estimate is a range and never guaranteed", opt ? `${opt.estimate.arrivalFrom} – ${opt.estimate.arrivalTo}` : "no option")

  // Seeds: holidays and every brand's profile.
  const jp = await (await fetch(`${base}/api/shipping/holidays?country=JP&from=2026-12-30&to=2027-01-04`)).json().catch(() => null)
  add(JSON.stringify(jp?.items?.map((h) => h.date)) === JSON.stringify(["2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03"]), "Japan's New Year closures are seeded", JSON.stringify(jp?.items?.map((h) => h.date)))

  // Register as the cluster's own test shopper: no chart signal (§6.3).
  const r = await fetch(`${base}/api/auth/demo`, { method: "POST", headers: headers(), body: JSON.stringify({ actor: "shopper", account: "u_t_d1" }) })
  const shopper = r.headers.getSetCookie().map((x) => x.split(";")[0]).join("; ")
  const line = { productId: "p_third_mainland_tee", variantId: "p_third_mainland_tee_v1", qty: 1 }
  const quote = await (await fetch(`${base}/api/shipping/quote`, { method: "POST", headers: headers(), body: JSON.stringify({ to: "NG", currency: "NGN", groups: [{ brandId: "b_lagos_static", lines: [line] }] }) })).json()
  const reg = await fetch(`${base}/api/orders/register`, {
    method: "POST",
    headers: headers({ cookie: shopper }),
    body: JSON.stringify({ idempotencyKey: `dcheck-${Date.now()}`, currency: "NGN", shipTo: { country: "NG" }, groups: [{ lines: [line], service: "standard", quoteToken: quote.groups[0].quoteToken }] }),
  })
  const body = await reg.json()
  add(reg.status === 201 && body.orders?.[0]?.id?.startsWith("or_") && body.groupId?.startsWith("cg_"), "register mints or_/cg_ ids", `${reg.status} ${body.orders?.[0]?.id ?? JSON.stringify(body).slice(0, 120)}`)
  if (cookie) {
    const sig = await fetch(`${base}/api/dev/signals?actor=u_t_d1`, { headers: { cookie } })
    if (sig.ok) {
      const s = await sig.json()
      add((s.items ?? []).length === 0, "register writes no chart_events", `${(s.items ?? []).length} events for u_t_d1`)
    } else add(null, "register writes no chart_events", `dev signals ${sig.status}`)
  } else add(null, "register writes no chart_events", "no admin cookie")

  // The two order-id guards accept server-minted ids (an or_* order placed now opens, not a 404).
  const guard = read("src/lib/shipping/order-ids.ts")
  add(/PLACED_ORDER_ID/.test(guard) && /isPlacedOrderId/.test(read("src/app/(market)/you/orders/[id]/layout.tsx")) && /isPlacedOrderId/.test(read("src/app/studio/(workspace)/orders/[id]/page.tsx")), "order pages accept server-minted or_* ids")
  if (body.orders?.[0]?.id) {
    const page = await fetch(`${base}/you/orders/${body.orders[0].id}`)
    add(page.status === 200, "/you/orders/<or_ id> answers 200", `${page.status}`)
    // A malformed id (a NUL byte) is a 404 before any query, not a 500.
    const nul = await fetch(`${base}/api/orders/or_a%00b/delivery`, { headers: { cookie: shopper } })
    add(nul.status === 404, "a NUL in an order id is 404", `${nul.status}`)
  }

  // Test-data hygiene (§9.0): remove this check's checkout (D's test shopper only, owner admin).
  if (cookie) {
    const scope = { customers: ["u_t_d1"], since: started }
    const c = await fetch(`${base}/api/shipping/dev/cleanup`, { method: "POST", headers: headers({ cookie }), body: JSON.stringify(scope) })
    const left = c.ok ? await (await fetch(`${base}/api/shipping/dev/cleanup`, { method: "POST", headers: headers({ cookie }), body: JSON.stringify({ ...scope, dryRun: true }) })).json() : null
    add(c.ok && left && left.groups.length === 0, "cleanup leaves no u_t_d1 checkouts", c.ok ? `${(await c.json()).groups.length} removed` : `${c.status}`)
  } else add(null, "cleanup leaves no u_t_d1 checkouts", "no admin cookie")
  return out
}

// Run on its own (`node scripts/checks/<name>.mjs`): db-check signs in a demo admin and runs just this file.
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const { spawnSync } = await import("node:child_process")
  const root = path.resolve(import.meta.dirname, "..", "..")
  process.exit(spawnSync(process.execPath, [path.join(root, "scripts", "db-check.mjs"), path.basename(import.meta.filename, ".mjs")], { cwd: root, stdio: "inherit" }).status ?? 1)
}
