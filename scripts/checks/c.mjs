// C (Charts) project checks, loaded by scripts/db-check.mjs. Each returns { status, name, detail }.
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

const BOARDS = ["top", "trending", "emerging", "most-followed", "most-wishlisted", "top-drops", "city"]
const PERIODS = ["daily", "weekly", "monthly"]

export default async function c({ base }) {
  const out = []
  const add = (ok, name, detail) => out.push({ status: ok === null ? "SKIP" : ok ? "PASS" : "FAIL", name, detail })
  const root = process.cwd()

  // score.ts is a plain-Node file: no server-only, no @/ aliases (§1.8), so npm test can load it.
  for (const f of ["src/server/charts/score.ts", "src/server/charts/detect.ts"]) {
    const src = readFileSync(path.join(root, f), "utf8")
    add(!/from "server-only"|import "server-only"|from "@\//.test(src), `${f} is plain Node`)
  }
  add(existsSync(path.join(root, "src/server/charts/score.test.ts")), "score.test.ts present (npm test)")

  // Every public board: gapless ranks, sample:true, no score or components, sponsored separate.
  let bad = []
  for (const chart of BOARDS)
    for (const period of PERIODS) {
      const r = await fetch(`${base}/api/charts?chart=${chart}&period=${period}`)
      if (!r.ok) {
        bad.push(`${chart}/${period}: ${r.status}`)
        continue
      }
      const d = await r.json()
      const ranks = d.entries.map((e) => e.rank)
      const leak = JSON.stringify(d.entries).match(/"(score|components)"/)
      const top10 = new Set(d.entries.slice(0, 10).flatMap((e) => [e.subject.id, e.brand.id]))
      const spons = d.sponsored.some((s) => (s.kind === "brand" ? top10.has(s.brand.id) : top10.has(s.drop?.id)))
      if (d.sample !== true || leak || ranks.some((x, i) => x !== i + 1) || d.sponsored.length > 2 || spons) bad.push(`${chart}/${period}`)
      if (JSON.stringify(d).includes("b_paper_riot")) bad.push(`${chart}/${period}: Paper Riot listed`)
    }
  add(bad.length === 0, "21 boards: gapless ranks, sample:true, no score/components, sponsored separate, Paper Riot held", bad.join(", "))

  const scopes = await (await fetch(`${base}/api/charts/scopes`)).json()
  const lagos = scopes.cities?.find((x) => x.slug === "lagos")
  add(lagos && lagos.eligible >= 3, "scopes: Lagos has a city chart", JSON.stringify(lagos))

  const city = await (await fetch(`${base}/api/charts?chart=city`)).json()
  add(city.scope?.city?.slug === "lagos" && city.state === "ok", "City charts opens on Lagos", city.scope?.city?.slug)

  const berlin = await (await fetch(`${base}/api/charts?chart=city&city=berlin`)).json()
  add(berlin.state === "small_cohort" && berlin.fallback?.country?.code === "DE", "Berlin: small cohort with a Germany fallback", JSON.stringify(berlin.fallback))

  const brand = await (await fetch(`${base}/api/charts/brand/b_lagos_static`)).json()
  add(brand.sample === true && (!brand.best || brand.best.label.startsWith("#")), "brand endpoint: a label or { sample: true }", JSON.stringify(brand))

  // Editions written by the backfill: finals for the last 8 days, so movement and history have data.
  const top = await (await fetch(`${base}/api/charts?chart=top&period=weekly`)).json()
  const withHistory = top.entries.filter((e) => e.history.filter((x) => x !== null).length >= 2).length
  add(top.edition?.status === "live" && withHistory > 0, "live edition with history from final editions", `${withHistory}/${top.entries.length} entries with history`)
  return out
}
