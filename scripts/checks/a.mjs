// Cluster A (Around) project checks, loaded by scripts/db-check.mjs. Each returns { status, name, detail }.
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

export default async function a({ base }) {
  const out = []
  const add = (ok, name, detail) => out.push({ status: ok === null ? "SKIP" : ok ? "PASS" : "FAIL", name, detail })
  const root = process.cwd()
  const read = (p) => readFileSync(path.join(root, p), "utf8")

  // Every public read goes through publicPlaces(), and the seed module is real (not F1's stub).
  add(/export function publicPlaceWhere/.test(read("src/server/around/public.ts")), "publicPlaces() predicate present")
  const reads = read("src/server/around/reads.ts")
  add(/publicPlaces\(/.test(reads) && !/from\(t\.brandLocations\)/.test(reads), "public reads use publicPlaces() only")
  add(/version: 1/.test(read("src/server/db/seed/around.ts")), "seed:around is version 1")
  add(existsSync(path.join(root, "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs")), "MapLibre worker file present")
  // Privacy (§5.6): the client never stores or sends a fix.
  const app = read("src/components/around/around-app.tsx")
  add(!/localStorage/.test(app) && !/writeParams\(\{[^}]*\bfix\b/.test(app), "Around app never writes a fix to storage or the URL")

  // Review 2026-11-07: the write rules that a curl run can't fully show.
  const svc = read("src/server/around/service.ts")
  add(/sample: false/.test(svc), "Duplicate never copies the sample flag")
  add(/mediaIdsOf\(events\.map\(\(e\) => e\.image\)\)/.test(svc.slice(svc.indexOf("export async function updateLocation"), svc.indexOf("export async function deleteLocation"))), "place writes refresh their events' photos too (§5.4)")
  add(/placeInTx\(/.test(svc) && /conflict\(/.test(svc) && /sameInstant\(/.test(svc), "writes re-read the row inside the transaction and compare-and-swap (409 on a change)")
  add(/dateRangeProblems/.test(read("src/lib/api/contracts/around.ts")) && /otherCityPinProblem/.test(svc), "date ranges and Other-city pins are checked on the server")

  let world
  try {
    world = await (await fetch(`${base}/api/around/places?scope=world`)).json()
  } catch (e) {
    add(false, "GET /api/around/places?scope=world", String(e))
    return out
  }
  const ids = (world.places ?? []).map((p) => p.id)
  add(ids.length >= 15 && !ids.includes("loc_seed_or_surulere") && !ids.includes("loc_seed_ls_removed") && !ids.includes("loc_seed_ls_rejected"), "world list: seeded public places only", `${ids.length} places`)
  add((world.places ?? []).filter((p) => p.id.startsWith("loc_seed_")).every((p) => p.sample && p.pinPrecision === "area"), "seeded places are sample, area pins")
  const detail = await fetch(`${base}/api/around/places/loc_seed_or_surulere`)
  add(detail.status === 404, "pending place detail is 404")
  const tiles = await fetch(`${base}/api/around/places?tiles=0_0,0_1,0_2,0_3,1_0,1_1,1_2,1_3,2_0,2_1,2_2,2_3,3_0`)
  add(tiles.status === 400, "13 tiles is 400")
  const worker = await fetch(`${base}/vendor/maplibre-gl-worker.mjs?v=6.16.0`)
  add(worker.status === 200 && /text\/javascript/.test(worker.headers.get("content-type") ?? "") && /immutable/.test(worker.headers.get("cache-control") ?? ""), "worker served as text/javascript, immutable")
  // City coastlines for the bundled map: one ODbL extract per gazetteer city, served from /vendor.
  const gaz = read("src/lib/around/gazetteer.ts")
  const slugs = [...gaz.matchAll(/slug: "([a-z-]+)",\s*name: "[^"]+",\s*country:/g)].map((m) => m[1])
  const missing = slugs.filter((s) => !existsSync(path.join(root, "src/lib/around/coast", `${s}.json`)))
  add(slugs.length >= 12 && missing.length === 0 && /ODbL/.test(read("src/lib/around/coast/README.md")), "a coastline extract (and its ODbL note) for every gazetteer city", missing.join(", "))
  const coast = await fetch(`${base}/vendor/around-coast/lagos.json?v=5`)
  add(coast.status === 200 && /application\/json/.test(coast.headers.get("content-type") ?? "") && (await fetch(`${base}/vendor/around-coast/cairo.json`)).status === 404, "coastline route: gazetteer cities only")
  const online = await (await fetch(`${base}/api/around/online-brands?city=berlin`)).json()
  add((online.brands ?? []).some((b) => b.id === "b_afterhours_ceramics"), "Berlin online-only rail lists Afterhours Ceramics")
  return out
}

// Run on its own (`node scripts/checks/<name>.mjs`): db-check signs in a demo admin and runs just this file.
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const { spawnSync } = await import("node:child_process")
  const root = path.resolve(import.meta.dirname, "..", "..")
  process.exit(spawnSync(process.execPath, [path.join(root, "scripts", "db-check.mjs"), path.basename(import.meta.filename, ".mjs")], { cwd: root, stdio: "inherit" }).status ?? 1)
}
