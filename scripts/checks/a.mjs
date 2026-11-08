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

  // Globe polish (owner screenshots 2026-11-07, 22:45). The browser proof is scratchpad/a2g/verify.js.
  const map = read("src/components/around/map/around-map.tsx")
  const rim = map.match(/ref=\{rimRef\}[^>]*className="([^"]+)"/)?.[1] ?? ""
  add(!!rim && !/purple|violet/.test(rim) && !/"horizon-color": "#1c0f36"/.test(map), "the globe's rim and horizon are grey, not purple (purple is for active and selected only)")
  add(/pickCreditSpot\(/.test(map) && /creditSpots=\{desktop \? CREDITS_DESKTOP : CREDITS_PHONE\}/.test(app) && /z-\[5\]/.test(map), "map credits sit above pins and move to a spot no pin covers")
  add(!/text-violet/.test(read("src/components/around/place-card.tsx")) && !/showroom: "bg-violet"/.test(read("src/components/around/map/pins.ts")) && !/StorefrontIcon[^>]*text-violet/.test(app), "drop and event lines, the showroom dot and the pill icon are ink or grey, not violet")
  add(/railKeyRef/.test(app) && /className="shrink-0"/.test(app), "the phone rail restarts at the nearest card after a re-sort and its slots never shrink")
  add(/revealPlace\(placeParam, p\)/.test(app) && !/inBounds\(p, v\.bounds\)/.test(app), "an opened place's pin is brought into the free part of the map, not just anywhere on the canvas")

  // Review 2026-11-08. The browser proof is scratchpad/a2g/verify2.js.
  add(/pinState: async/.test(map) && /getClusterExpansionZoom\(cid\)/.test(map) && /pinClear\(root, st\.rect\)/.test(app), "an opened place counts as in view only when its own pin is drawn (not folded into a cluster)")
  add(/data-map-chrome onClick=\{onPill\}/.test(app) && /querySelectorAll\("\[data-map-chrome\]"\)/.test(app), "a selected pin under the area pill or another control isn't in view: the camera moves")
  add(/note=\{desktop \? null : youHint\}/.test(app) && /data-map-note/.test(map) && !/\{youHint \? <p className="glass/.test(app), "the phone's \"you\" hint moves with the credits to a spot no pin covers, not over the pins above the pill")
  add(/areaCamera\(fit\.area, frameNow\(\), all\)/.test(app) && /cameraForFix\(pos\.lat, pos\.lng, frameNow\(\), knownRef\.current\)/.test(app) && !/areaCamera\([^)]*shownOnMap/.test(app), "small phones frame a city's places; the camera uses every known place, never the distance-filtered set (§5.6)")
  add(/w-\[calc\(100vw-280px\)\]/.test(app) && /scroll-px-4 gap-4/.test(app), "the phone rail lets every card, the last included, rest at the left edge")
  const detailSrc = read("src/components/around/place-detail.tsx")
  add(!/text-violet/.test(detailSrc) && /loading=\{i === 0 \? "eager" : "lazy"\}/.test(detailSrc), "PlaceDetail: the verified seal is ink and the first photo loads eagerly")
  add(!/hover:text-violet/.test(read("src/components/studio/locations/locations-index.tsx")) && /min-h-10/.test(read("src/components/studio/locations/pickers.tsx")), "Studio Locations: name links underline in ink; the pickers' Clear has a 40 px tap target")

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
