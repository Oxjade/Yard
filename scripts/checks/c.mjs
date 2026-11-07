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
      const onBoard = new Set(d.entries.flatMap((e) => [e.subject.id, e.brand.id]))
      const spons = d.sponsored.some((s) => (s.kind === "brand" ? onBoard.has(s.brand.id) : onBoard.has(s.drop?.id)) || "campaignId" in s)
      if (d.sample !== true || leak || ranks.some((x, i) => x !== i + 1) || d.sponsored.length > 2 || spons) bad.push(`${chart}/${period}`)
      if (JSON.stringify(d).includes("b_paper_riot")) bad.push(`${chart}/${period}: Paper Riot listed`)
    }
  add(bad.length === 0, "21 boards: gapless ranks, sample:true, no score/components, sponsored separate (never on the board, no campaign ids), Paper Riot held", bad.join(", "))

  // Only real scopes: an invented category, country or city is 400 and never echoed.
  const junk = ["category=call-yard-support-on-whatsapp", "country=ZZ", "chart=city&city=nowhere-xyz"]
  const codes = await Promise.all(junk.map(async (q) => (await fetch(`${base}/api/charts?${q}`)).status))
  add(codes.every((c) => c === 400), "unknown category, country and city are 400", codes.join(" "))

  const scopes = await (await fetch(`${base}/api/charts/scopes`)).json()
  const lagos = scopes.cities?.find((x) => x.slug === "lagos")
  add(lagos && lagos.eligible >= 3, "scopes: Lagos has a city chart", JSON.stringify(lagos))
  const empty = [...(scopes.cities ?? []), ...(scopes.countries ?? [])].filter((x) => x.eligible === 0)
  add(empty.length === 0, "scopes list only places with an eligible brand", JSON.stringify(empty))

  const city = await (await fetch(`${base}/api/charts?chart=city`)).json()
  add(city.scope?.city?.slug === "lagos" && city.state === "ok", "City charts opens on Lagos", city.scope?.city?.slug)

  const berlin = await (await fetch(`${base}/api/charts?chart=city&city=berlin`)).json()
  add(berlin.state === "small_cohort" && !berlin.fallback?.country && berlin.fallback?.nearestCity?.slug === "lagos", "Berlin: small cohort; no Germany fallback (it has no chart), nearest city Lagos", JSON.stringify(berlin.fallback))

  const brand = await (await fetch(`${base}/api/charts/brand/b_lagos_static`)).json()
  add(brand.sample === true && (!brand.best || brand.best.label.startsWith("#")), "brand endpoint: a label or { sample: true }", JSON.stringify(brand))

  // Editions written by the backfill: finals for the last 8 days, so movement and history have data.
  const top = await (await fetch(`${base}/api/charts?chart=top&period=weekly`)).json()
  const withHistory = top.entries.filter((e) => e.history.filter((x) => x !== null).length >= 2).length
  add(top.edition?.status === "live" && withHistory > 0, "live edition with history from final editions", `${withHistory}/${top.entries.length} entries with history`)
  return out
}

// Run on its own (`node scripts/checks/<name>.mjs`): db-check signs in a demo admin and runs just this file.
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const { spawnSync } = await import("node:child_process")
  const root = path.resolve(import.meta.dirname, "..", "..")
  process.exit(spawnSync(process.execPath, [path.join(root, "scripts", "db-check.mjs"), path.basename(import.meta.filename, ".mjs")], { cwd: root, stdio: "inherit" }).status ?? 1)
}
