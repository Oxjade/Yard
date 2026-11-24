#!/usr/bin/env node
// Studio gate and payout-account access, live acceptance kit. Plain Node 22 (fetch, no deps). Prints
// one PASS/FAIL line per check and exits non-zero when any check fails.
//
//   node scripts/checks/v3-studio-gate.mjs            (server at YARD_BASE, default http://localhost:3000)
//
// Against a PRODUCTION server (demo switch off): signed out, every Studio page except sign-in and
// onboarding redirects (307) to /studio/sign-in?next=<the page>, the page HTML never carries the
// sample brand's payout account, and the payout-account API answers 401.
// Against a DEMO or DEVELOPMENT server (demo sign-in on): Studio pages render without a redirect, and
// the payout-account API answers 401 signed out and 403 to every brand member who isn't the owner
// (the owner without a recent re-auth gets 403 "reauth", never a save).

const base = (process.env.YARD_BASE ?? "http://localhost:3000").replace(/\/$/, "")
let failed = 0
function check(name, ok, detail = "") {
  if (!ok) failed++
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 400)}` : ""}`)
}

async function req(method, path, { cookie, body } = {}) {
  const headers = { Origin: base, "X-Yard-Client": "1", ...(cookie ? { cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }
  const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: "manual" })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {}
  return { status: res.status, res, text, body: json }
}
const cookieOf = (res) => (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ")

const ACCOUNT = { country: "NG", currency: "NGN", bankCode: "058", bankName: "GTBank", accountName: "Kit Check Ltd", accountNumber: "0123456789" }

const session = (await req("GET", "/api/session")).body
const production = session?.sampleData === false
console.log(`# ${base}: ${production ? "production (demo switch off)" : "demo / development"}`)

/* ---------- Pages ---------- */
if (production) {
  for (const path of ["/studio/settings", "/studio/payouts", "/studio", "/studio/orders", "/studio/products"]) {
    const r = await req("GET", path)
    const want = path === "/studio" ? "/studio/sign-in" : `/studio/sign-in?next=${encodeURIComponent(path)}`
    const loc = r.res.headers.get("location") ?? ""
    check(`anonymous ${path} → 307 to the Studio sign-in with next`, r.status === 307 && new URL(loc, base).pathname + new URL(loc, base).search === want, { status: r.status, location: loc })
  }
  const withQuery = await req("GET", "/studio/payouts?tab=history")
  check("the return address keeps the query", (withQuery.res.headers.get("location") ?? "").endsWith(`next=${encodeURIComponent("/studio/payouts?tab=history")}`), withQuery.res.headers.get("location"))
  for (const path of ["/studio/sign-in", "/studio/onboarding"]) check(`anonymous ${path} is served (200)`, (await req("GET", path)).status === 200)
  // A stale or forged cookie passes the proxy; the page itself must still show nothing of the sample brand.
  const stale = await req("GET", "/studio/settings", { cookie: "yard_b=stale.invalid" })
  check("with an invalid brand cookie the page renders, without the sample brand's payout account", stale.status === 200 && !/4821|LAGOS STATIC STUDIO LTD|Paystack to GTBank/.test(stale.text), stale.status)
} else {
  const r = await req("GET", "/studio/settings")
  check("demo: anonymous /studio/settings renders (no redirect)", r.status === 200, r.status)
}

/* ---------- Payout-account API ---------- */
{
  const g = await req("GET", "/api/studio/payouts/account")
  const p = await req("PUT", "/api/studio/payouts/account", { body: ACCOUNT })
  check("payout account: GET anonymous → 401", g.status === 401, g.status)
  check("payout account: PUT anonymous → 401", p.status === 401, p.status)
  check("payout account: the anonymous answers never echo the number", !g.text.includes(ACCOUNT.accountNumber) && !p.text.includes(ACCOUNT.accountNumber))
}

if (session?.demoAuth?.brand) {
  const members = []
  for (const account of ["u_b_tobi", "u_b_kemi", "u_b_designer", "u_b_viewer"]) {
    const r = await req("POST", "/api/auth/demo", { body: { actor: "brand", account } })
    if (r.status === 200) members.push({ account, role: r.body?.profile?.role, cookie: cookieOf(r.res) })
  }
  const nonOwners = members.filter((m) => m.role !== "owner")
  check("setup: demo brand members signed in (owner and non-owners)", members.some((m) => m.role === "owner") && nonOwners.length > 0, members.map((m) => `${m.account}:${m.role}`))
  for (const m of nonOwners) {
    const r = await req("PUT", "/api/studio/payouts/account", { cookie: m.cookie, body: ACCOUNT })
    check(`payout account: PUT as ${m.role} (${m.account}) → 403`, r.status === 403 && r.body?.error?.code === "forbidden", { status: r.status, body: r.body })
  }
  for (const m of nonOwners.filter((x) => !["owner", "admin", "finance"].includes(x.role))) {
    const r = await req("GET", "/api/studio/payouts/account", { cookie: m.cookie })
    check(`payout account: GET as ${m.role} → 403 (finance view roles only)`, r.status === 403, r.status)
  }
  const owner = members.find((m) => m.role === "owner")
  if (owner) {
    const r = await req("PUT", "/api/studio/payouts/account", { cookie: owner.cookie, body: ACCOUNT })
    check("payout account: owner without a recent re-auth → 403 reauth (nothing saved)", r.status === 403 && r.body?.error?.fields?.reauth === "required", { status: r.status, body: r.body })
  }
} else {
  console.log("# demo sign-in is off here: the non-owner 403 checks run against a demo or development server")
}

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed")
process.exit(failed ? 1 : 0)
