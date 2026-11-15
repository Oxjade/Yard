// Yard Around globe for Android: a port of the website's map engine onto the same MapLibre GL JS
// 6.16.0 build, loaded from the APK's assets. Sources, kept in step by hand:
//   src/components/around/map/around-map.tsx  (base style, markers, rim, scale bar, coasts, labels,
//                                              credits, streets, flyTo, pinState)
//   src/components/around/map/areas.ts         (neighbourhood rings, label and credit placement)
//   src/components/around/map/pins.ts          (pins, clusters, "you" dot, area names)
//   src/components/around/map/world-data.ts    (Natural Earth, city coastlines, fallback land path)
//   src/components/around/svg-fallback.tsx     (the map without WebGL)
//   src/components/around/around-app.tsx       (the Snap-style title, the "you" hint, reveal)
//   src/lib/around/geo.ts + gazetteer.ts       (cameraArea, HOOD_ZOOM; data/gazetteer.json)
//
// Bridge (AroundGlobeBridge.kt):
//   Kotlin → JS  window.yardGlobe.receive({type, …})
//     places {places:[{id,lat,lng,brand,markText,markStyle,kindLabel,area,city,citySlug,status,sample}]}
//     select {id|null, area|null}     flyTo {lat,lng,zoom,animate}     reveal {id,lat,lng}
//     you {lat,lng} | {}              chrome {wide, peek, covered}     motion {reduced}
//   JS → Kotlin  YardAndroid.post(JSON)
//     ready · placeTapped {id} · cameraIdle {lat,lng,zoom,west,south,east,north,user} ·
//     youHint {text|null} ·
//     streets {state} · fallback {reason} · cityTapped {slug}

import * as ml from "./vendor/maplibre-gl.js"

/* ---- constants (around-map.tsx, geo.ts) ---- */

const OCEAN = "#060609"
const LAND = "#1d1c24"
const RING_OPACITY = 0.18
const RING_OPACITY_STREETS = 0.07
/** City coastlines fade in over Natural Earth's between these zooms. */
const COAST_MIN_ZOOM = 9.4
/** Neighbourhood names, rings and dots show from this zoom (geo.ts HOOD_ZOOM). */
const HOOD_ZOOM = 10.2
const BUNDLED_MAX_ZOOM = 14.5
const STREETS_MAX_ZOOM = 18
const STYLE_URL = "https://tiles.openfreemap.org/styles/dark"
const EMPTY = { type: "FeatureCollection", features: [] }
/** Cities with a bundled coastline (assets/around/coast, © OpenStreetMap contributors, ODbL). */
const COAST_SLUGS = new Set(["abuja", "accra", "berlin", "johannesburg", "lagos", "london", "mexico-city", "nairobi", "new-york", "paris", "seoul", "tokyo"])

const coastFade = (to) => ["interpolate", ["linear"], ["zoom"], COAST_MIN_ZOOM, 0, 10.2, to]
/** An area's ring or dot fades out when its name can't be shown clear of the page chrome. */
const unlessHidden = (v) => ["case", ["boolean", ["feature-state", "hidden"], false], 0, v]
const ringOpacity = (to) => ["interpolate", ["linear"], ["zoom"], HOOD_ZOOM - 0.4, 0, HOOD_ZOOM + 0.2, unlessHidden(to)]

/* ---- the Android screen around the map (sent by Kotlin; the website's are page constants) ---- */

let chrome = { wide: false, peek: 0, covered: 0 }
let reducedFlag = false

/** Camera padding: the camera's centre sits in what the sheet (phone) leaves free (website PAD_PHONE / PAD_DESKTOP). */
const padding = () => (chrome.wide ? { top: 72, right: 72, bottom: 24, left: 24 } : { top: 56, right: 16, bottom: Math.round(chrome.peek) + 16, left: 16 })
/** Screen bands that count as hidden for "in view" (website VIEW_PHONE / VIEW_DESKTOP). */
const viewInsets = () => (chrome.wide ? { top: 64, right: 72, bottom: 8, left: 8 } : { top: 48, right: 8, bottom: Math.round(chrome.peek), left: 8 })
/** Bands area names try to stay out of (website labelInsets); the sheet's band is only a preference. */
const labelInsets = () => (chrome.wide ? {} : { bottom: Math.round(chrome.peek) })
/**
 * Where the credits may sit, in order (website CREDITS_PHONE / CREDITS_DESKTOP): phones under the
 * title, a row lower at a time; wide screens the bottom-right corner, else left of the controls.
 */
const creditSpots = () =>
  chrome.wide
    ? [{ bottom: 4, right: 8 }, { bottom: 4, right: 80 }, { top: 76, right: 24 }]
    : [{ top: 56, left: 16 }, { top: 56, right: 16 }, { top: 92, left: 16 }, { top: 92, right: 16 }, { top: 128, left: 16 }, { top: 128, right: 16 }]

const post = (msg) => {
  try {
    if (window.YardAndroid) window.YardAndroid.post(JSON.stringify(msg))
  } catch (_) {
    /* the host went away */
  }
}

const reducedMotion = () => reducedFlag || window.matchMedia("(prefers-reduced-motion: reduce)").matches
const $ = (id) => document.getElementById(id)

function hasWebgl2() {
  try {
    return !!document.createElement("canvas").getContext("webgl2")
  } catch (_) {
    return false
  }
}

const getJson = (path) =>
  fetch(path).then((r) => {
    if (!r.ok) throw new Error(`${path}: ${r.status}`)
    return r.json()
  })

/* ---- the gazetteer (gazetteer.ts, geo.ts) ---- */

let cities = []
let gazetteerNames = []

function haversineKm(aLat, aLng, bLat, bLng) {
  const r = (d) => (d * Math.PI) / 180
  const dLat = r(bLat - aLat)
  const dLng = r(bLng - aLng)
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(x)))
}

function nearestArea(lat, lng, maxKm, kind) {
  let best = null
  for (const c of cities) {
    if (kind !== "neighbourhood") {
      const km = haversineKm(lat, lng, c.lat, c.lng)
      if (km <= maxKm && (!best || km < best.km)) best = { name: c.name, country: c.country, km }
    }
    if (kind !== "city") {
      for (const h of c.neighbourhoods) {
        const km = haversineKm(lat, lng, h.lat, h.lng)
        if (km <= maxKm && (!best || km < best.km)) best = { name: h.name, country: c.country, km }
      }
    }
  }
  return best
}

const countryNames = { NG: "Nigeria", GH: "Ghana", KE: "Kenya", ZA: "South Africa", GB: "United Kingdom", FR: "France", DE: "Germany", US: "United States", MX: "Mexico", JP: "Japan", KR: "South Korea" }

/** The Snap-style title for a camera (geo.ts cameraArea): Earth, a country, a city or a neighbourhood. */
function cameraTitle(lat, lng, zoom) {
  if (zoom >= 12) {
    const hood = nearestArea(lat, lng, 5, "neighbourhood")
    if (hood) return hood.name
  }
  if (zoom >= 8) {
    const city = nearestArea(lat, lng, 60, "city")
    if (city) return city.name
  }
  if (zoom >= 4) {
    const city = nearestArea(lat, lng, 900, "city")
    if (city) return countryNames[city.country] || city.country
  }
  return "Earth"
}

/* ---- area markers (areas.ts) ---- */

const RING_STEPS = 72

function ring(lat, lng, km) {
  const dLat = km / 110.574
  const dLng = km / (111.32 * Math.cos((lat * Math.PI) / 180))
  const out = []
  for (let i = 0; i <= RING_STEPS; i++) {
    const a = (i / RING_STEPS) * 2 * Math.PI
    out.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)])
  }
  return out
}

function neighbourhoodRadiusKm(lat, lng, siblings) {
  let nearest = Infinity
  for (const s of siblings) {
    if (s.lat === lat && s.lng === lng) continue
    nearest = Math.min(nearest, haversineKm(lat, lng, s.lat, s.lng))
  }
  if (!Number.isFinite(nearest)) return 1.2
  return Math.max(0.5, Math.min(1.6, nearest * 0.45))
}

function areaFeatures() {
  const rings = []
  const dots = []
  for (const c of cities) {
    dots.push({ type: "Feature", geometry: { type: "Point", coordinates: [c.lng, c.lat] }, properties: { level: "city", name: c.name, slug: c.slug } })
    for (const h of c.neighbourhoods) {
      const km = neighbourhoodRadiusKm(h.lat, h.lng, c.neighbourhoods)
      const props = { level: "neighbourhood", name: h.name, slug: `${c.slug}/${h.slug}` }
      rings.push({ type: "Feature", geometry: { type: "LineString", coordinates: ring(h.lat, h.lng, km) }, properties: props })
      dots.push({ type: "Feature", geometry: { type: "Point", coordinates: [h.lng, h.lat] }, properties: props })
    }
  }
  return { rings: { type: "FeatureCollection", features: rings }, dots: { type: "FeatureCollection", features: dots } }
}

function overlap(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

function labelCandidates(w, h) {
  const below = h / 2 + 7
  const clear = h / 2 + 27
  const side = w / 2 + 30
  return [[0, below], [0, -clear], [0, clear], [side, 0], [-side, 0], [0, -(clear + 26)], [0, clear + 26], [side + 26, 0], [-(side + 26), 0]]
}

function placeLabel(anchor, size, obstacles, placed, view) {
  let best = null
  let bestCost = Infinity
  for (const offset of labelCandidates(size.w, size.h)) {
    const rect = { x: anchor.x + offset[0] - size.w / 2, y: anchor.y + offset[1] - size.h / 2, w: size.w, h: size.h }
    let cost = 0
    for (const o of obstacles) cost += overlap(rect, o) * 3
    for (const p of placed) cost += overlap(rect, p)
    if (view) cost += (rect.w * rect.h - overlap(rect, { x: 0, y: 0, w: view.w, h: view.h })) * 3
    if (cost === 0) return { offset, rect }
    if (cost < bestCost) {
      bestCost = cost
      best = { offset, rect }
    }
  }
  return best
}

function spotRect(spot, size, view) {
  const x = spot.left ?? view.w - (spot.right ?? 0) - size.w
  const y = spot.top ?? view.h - (spot.bottom ?? 0) - size.h
  return { x, y, w: size.w, h: size.h }
}

function pickCreditSpot(spots, size, view, pins) {
  let best = 0
  let bestCost = Infinity
  for (let i = 0; i < spots.length; i++) {
    const r = spotRect(spots[i], size, view)
    const padded = { x: r.x - 4, y: r.y - 4, w: r.w + 8, h: r.h + 8 }
    let cost = 0
    for (const p of pins) cost += overlap(padded, p)
    if (cost === 0) return i
    if (cost < bestCost) {
      bestCost = cost
      best = i
    }
  }
  return best
}

function applySpot(el, spot, index) {
  const px = (v) => (v == null ? "auto" : `${v}px`)
  el.style.top = px(spot.top)
  el.style.bottom = px(spot.bottom)
  el.style.left = px(spot.left)
  el.style.right = px(spot.right)
  el.style.alignItems = spot.right != null ? "flex-end" : "flex-start"
  el.dataset.spot = String(index)
}

/* ---- Natural Earth and city coastlines (world-data.ts) ---- */

function splitAtJumps(lines) {
  const out = []
  for (const line of lines) {
    let cur = []
    for (const pt of line) {
      const prev = cur[cur.length - 1]
      if (prev && Math.abs(pt[0] - prev[0]) > 180) {
        if (cur.length > 1) out.push(cur)
        cur = []
      }
      cur.push(pt)
    }
    if (cur.length > 1) out.push(cur)
  }
  return out
}

function ringsOf(fc) {
  const rings = []
  for (const f of fc.features) {
    const g = f.geometry
    if (g.type === "Polygon") rings.push(...g.coordinates)
    else if (g.type === "MultiPolygon") for (const poly of g.coordinates) rings.push(...poly)
  }
  return rings
}

async function loadWorld() {
  const [landTopo, countriesTopo] = await Promise.all([getJson("vendor/land-50m.json"), getJson("vendor/countries-110m.json")])
  const topo = window.topojson
  const land = topo.feature(landTopo, landTopo.objects.land)
  const borderMesh = topo.mesh(countriesTopo, countriesTopo.objects.countries, (a, b) => a !== b)
  return {
    land,
    coast: { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: splitAtJumps(ringsOf(land)) } },
    borders: { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: splitAtJumps(borderMesh.coordinates) } },
  }
}

/** Land as one equirectangular SVG path (viewBox 1000×500), for the fallback map. */
async function landPath() {
  const t = await getJson("vendor/land-110m.json")
  const fc = window.topojson.feature(t, t.objects.land)
  const x = (lng) => ((lng + 180) / 360) * 1000
  const y = (lat) => ((90 - lat) / 180) * 500
  const piece = (r) => r.map(([lng, lat], i) => `${i ? "L" : "M"}${x(lng).toFixed(1)} ${y(lat).toFixed(1)}`).join("") + "Z"
  const ringPath = (r) => splitAtJumps([r]).filter((part) => part.length >= 3).map(piece).join("")
  let d = ""
  for (const f of fc.features) {
    const g = f.geometry
    if (g.type === "Polygon") for (const r of g.coordinates) d += ringPath(r)
    else if (g.type === "MultiPolygon") for (const poly of g.coordinates) for (const r of poly) d += ringPath(r)
  }
  return d
}

const coastCache = new Map()

function loadCoast(slug) {
  if (!COAST_SLUGS.has(slug)) return Promise.reject(new Error("no coast"))
  let p = coastCache.get(slug)
  if (!p) {
    p = getJson(`coast/${slug}.json`).then((f) => ({
      slug: f.slug,
      bbox: f.bbox,
      land: f.land.map((rings) => ({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: rings } })),
      water: f.water.map((rings) => ({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: rings } })),
      shore: { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: f.shore } },
    }))
    coastCache.set(slug, p)
    p.catch(() => coastCache.delete(slug))
  }
  return p
}

function prefetchCoasts(at) {
  for (const city of cities) if (haversineKm(at.lat, at.lng, city.lat, city.lng) <= 160) loadCoast(city.slug).catch(() => {})
}

/* ---- the base style (around-map.tsx baseStyle) ---- */

function baseStyle(world, areas) {
  return {
    version: 8,
    projection: { type: "globe" },
    // No glow (house rule): the atmosphere is off and the rim is a grey hairline overlay instead.
    sky: { "sky-color": "#080808", "horizon-color": "#121212", "fog-color": "#080808", "atmosphere-blend": 0 },
    sources: {
      land: { type: "geojson", data: world.land },
      coast: { type: "geojson", data: world.coast },
      borders: { type: "geojson", data: world.borders },
      "coast-mask": { type: "geojson", data: EMPTY },
      "coast-land": { type: "geojson", data: EMPTY },
      "coast-water": { type: "geojson", data: EMPTY },
      "coast-shore": { type: "geojson", data: EMPTY },
      "area-rings": { type: "geojson", data: areas.rings, promoteId: "slug" },
      "area-dots": { type: "geojson", data: areas.dots, promoteId: "slug" },
      places: { type: "geojson", data: EMPTY, cluster: true, clusterRadius: 56, clusterMaxZoom: 14 },
    },
    layers: [
      { id: "ocean", type: "background", paint: { "background-color": OCEAN } },
      { id: "land", type: "fill", source: "land", paint: { "fill-color": LAND, "fill-antialias": false } },
      {
        id: "coast",
        type: "line",
        source: "coast",
        paint: {
          "line-color": "#f5f5f5",
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 3, 0.1, 9, 0.24],
          "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.6, 10, 1, 14, 1.5],
        },
      },
      // A covered city's own coastline, lakes and rivers take over from Natural Earth's outline at city zoom.
      { id: "coast-mask", type: "fill", source: "coast-mask", minzoom: COAST_MIN_ZOOM, paint: { "fill-color": OCEAN, "fill-antialias": false, "fill-opacity": coastFade(1) } },
      { id: "coast-land", type: "fill", source: "coast-land", minzoom: COAST_MIN_ZOOM, paint: { "fill-color": LAND, "fill-antialias": false, "fill-opacity": coastFade(1) } },
      { id: "coast-water", type: "fill", source: "coast-water", minzoom: COAST_MIN_ZOOM, paint: { "fill-color": OCEAN, "fill-opacity": coastFade(1) } },
      {
        id: "coast-shore",
        type: "line",
        source: "coast-shore",
        minzoom: COAST_MIN_ZOOM,
        paint: { "line-color": "#f5f5f5", "line-opacity": coastFade(0.24), "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1, 14, 1.5] },
      },
      { id: "borders", type: "line", source: "borders", paint: { "line-color": "rgba(245,245,245,0.07)", "line-width": 0.5 } },
      // Every gazetteer neighbourhood: a dashed ring ("roughly here", like an area pin) and a dot.
      {
        id: "area-rings",
        type: "line",
        source: "area-rings",
        minzoom: HOOD_ZOOM - 0.4,
        paint: { "line-color": "#f5f5f5", "line-opacity": ringOpacity(RING_OPACITY), "line-width": 1, "line-dasharray": [2, 3] },
      },
      {
        id: "area-dots-neighbourhood",
        type: "circle",
        source: "area-dots",
        minzoom: HOOD_ZOOM,
        filter: ["==", ["get", "level"], "neighbourhood"],
        paint: {
          "circle-radius": 3,
          "circle-color": OCEAN,
          "circle-opacity": unlessHidden(1),
          "circle-stroke-color": "#f5f5f5",
          "circle-stroke-opacity": unlessHidden(0.6),
          "circle-stroke-width": 1.25,
        },
      },
      {
        id: "area-dots-city",
        type: "circle",
        source: "area-dots",
        minzoom: 3.6,
        maxzoom: HOOD_ZOOM,
        filter: ["==", ["get", "level"], "city"],
        paint: { "circle-radius": 3, "circle-color": "#f5f5f5", "circle-opacity": unlessHidden(0.75), "circle-stroke-color": OCEAN, "circle-stroke-opacity": unlessHidden(1), "circle-stroke-width": 1.5 },
      },
      { id: "places-hit", type: "circle", source: "places", paint: { "circle-radius": 22, "circle-opacity": 0 } },
    ],
  }
}

/* ---- markers (pins.ts) ---- */

const markClass = (style) => (style === "condensed" ? "font-display" : style === "expanded" ? "font-wide" : "font-grotesk")

function pinLabel(p) {
  return `${p.brand}, ${p.kindLabel}, ${p.area}${p.sample ? ", sample" : ""}`
}

function placePin(p, onTap) {
  const el = document.createElement("button")
  el.type = "button"
  el.className = "yard-pin" + (p.sample ? " sample" : "")
  el.dataset.placeId = p.id
  el.setAttribute("aria-label", pinLabel(p))
  const mark = document.createElement("span")
  mark.className = `yard-mark ${markClass(p.markStyle)}`
  mark.setAttribute("aria-hidden", "true")
  mark.textContent = p.markText || ""
  const dot = document.createElement("span")
  dot.className = `yard-dot ${p.status}`
  dot.setAttribute("aria-hidden", "true")
  el.append(mark, dot)
  // Pins stack above area names (1) and the "you" dot; the selected pin above every other pin.
  el.style.zIndex = "2"
  el.addEventListener("click", (e) => {
    e.stopPropagation()
    onTap(p.id)
  })
  return el
}

/** The selected pin: a purple 3 px ring and a slight lift (no lift under reduced motion). */
function setPinSelected(el, selected) {
  el.classList.toggle("selected", selected)
  el.style.zIndex = selected ? "3" : "2"
  if (selected) el.setAttribute("aria-pressed", "true")
  else el.removeAttribute("aria-pressed")
}

function countChip(count) {
  const chip = document.createElement("span")
  chip.className = "yard-count"
  chip.setAttribute("aria-hidden", "true")
  chip.dataset.count = ""
  chip.textContent = String(count)
  return chip
}

function stackCircle(leaf, i) {
  const c = document.createElement("span")
  c.className = `yard-circle ${leaf ? markClass(leaf.markStyle) : ""}`
  c.setAttribute("aria-hidden", "true")
  c.style.zIndex = String(3 - i)
  c.textContent = leaf ? leaf.markText : ""
  return c
}

/** Up to three stacked brand marks, like Snap Map's stacked avatars, plus a count chip above 3. */
function clusterPin(count, onTap) {
  const el = document.createElement("button")
  el.type = "button"
  el.className = "yard-cluster"
  el.setAttribute("aria-label", `${count} places here. Zoom in`)
  el.style.zIndex = "2"
  const stack = document.createElement("span")
  stack.className = "yard-stack"
  for (let i = 0; i < Math.min(3, count); i++) stack.append(stackCircle(null, i))
  el.append(stack)
  if (count > 3) el.append(countChip(count))
  el.addEventListener("click", (e) => {
    e.stopPropagation()
    onTap()
  })
  return el
}

function fillCluster(el, leaves, count) {
  const stack = el.querySelector(".yard-stack")
  if (!stack) return
  // One circle per brand, so the stack reads as different brands, never "LS LS LS".
  const distinct = leaves.filter((l, i) => leaves.findIndex((x) => x.brand === l.brand) === i)
  const circles = distinct.slice(0, 3)
  stack.replaceChildren(...circles.map((l, i) => stackCircle(l, i)))
  if (count > circles.length && !el.querySelector("[data-count]")) el.append(countChip(count))
  const names = distinct.map((l) => l.brand)
  el.setAttribute("aria-label", `${count} places here${names.length ? `, including ${names.slice(0, 3).join(", ")}` : ""}. Zoom in`)
}

function youDot() {
  const el = document.createElement("div")
  el.className = "yard-you"
  el.setAttribute("role", "img")
  el.setAttribute("aria-label", "Your location, on this device only")
  el.style.zIndex = "1"
  return el
}

function areaLabel(text, level) {
  const el = document.createElement("div")
  el.setAttribute("aria-hidden", "true")
  el.className = level === "city" ? "yard-area city" : "yard-area hood"
  el.textContent = text
  return el
}

/* ---- the engine ---- */

let map = null
let places = []
let placesSig = ""
let selectedId = null
let selectedArea = null
let pendingCamera = null
let you = null
let youMarker = null
const markers = new Map()
const leafCache = new Map()
let raf = 0
let layoutDirty = true
let creditsDirty = true
let creditSpot = -1
let creditsOpen = true
let attribution = "base"
let coastCredit = false
let scale = null
let fallbackShown = false
/** Hooks the running map installs (placeLabels, syncLabels, ensureCoasts …). */
const engine = { placeLabels() {}, syncLabels() {}, ensureCoasts() {}, syncCoastCredit() {} }

function toFeatures(list) {
  return {
    type: "FeatureCollection",
    features: list.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      properties: { id: p.id, markText: p.markText || "", markStyle: p.markStyle || "grotesk", brand: p.brand, kindLabel: p.kindLabel, area: p.area, sample: !!p.sample, status: p.status },
    })),
  }
}

function reconcile() {
  if (!map) return
  const src = map.getSource("places")
  if (!src) return
  const feats = map.querySourceFeatures("places")
  const seen = new Set()
  for (const f of feats) {
    const props = f.properties || {}
    const coords = f.geometry.coordinates
    const isCluster = !!props.cluster
    const key = isCluster ? `c:${props.cluster_id}:${Math.floor(map.getZoom())}` : `p:${props.id}`
    if (seen.has(key)) continue
    seen.add(key)
    const existing = markers.get(key)
    if (existing) {
      if (!isCluster) setPinSelected(existing.el, props.id === selectedId)
      continue
    }
    let el
    if (isCluster) {
      const count = Number(props.point_count) || 0
      const clusterId = Number(props.cluster_id)
      el = clusterPin(count, () => {
        src.getClusterExpansionZoom(clusterId).then((z) => {
          const opts = { center: coords, zoom: Math.min(z + 0.25, 16) }
          if (reducedMotion()) map.jumpTo(opts)
          else map.easeTo({ ...opts, duration: 600 })
        }).catch(() => {})
      })
      let leaves = leafCache.get(key)
      if (!leaves) {
        // Ten leaves, so the stack can find three different brands (one brand's places repeat).
        leaves = src.getClusterLeaves(clusterId, 10, 0).then((ls) => ls.map((l) => ({ markText: String(l.properties?.markText ?? ""), markStyle: String(l.properties?.markStyle ?? ""), brand: String(l.properties?.brand ?? "") })))
        leafCache.set(key, leaves)
      }
      leaves.then((ls) => fillCluster(el, ls, count)).catch(() => {})
    } else {
      el = placePin(props, (id) => post({ type: "placeTapped", id }))
      setPinSelected(el, props.id === selectedId)
    }
    const marker = new ml.Marker({ element: el, anchor: "center", opacityWhenCovered: 0, subpixelPositioning: true }).setLngLat(coords).addTo(map)
    markers.set(key, { marker, el, cluster: isCluster })
    layoutDirty = true
  }
  for (const [key, m] of markers) {
    if (!seen.has(key)) {
      m.marker.remove()
      markers.delete(key)
      layoutDirty = true
    }
  }
}

/* ---- the globe's rim: a grey hairline where Snap Map has a blue glow ---- */
function syncRim() {
  const rim = $("rim")
  if (!rim || !map) return
  const z = map.getZoom()
  if (z > 4.5 || map.getPitch() > 1) {
    rim.style.display = "none"
    return
  }
  const c = map.getCenter()
  const cp = map.project(c)
  // The limb is where a point's screen distance from the centre peaks; sample along the east bearing.
  const lat0 = (c.lat * Math.PI) / 180
  const lng0 = (c.lng * Math.PI) / 180
  let r = 0
  for (let i = 1; i <= 90; i++) {
    const d = (i * Math.PI) / 90
    const lat = Math.asin(Math.sin(lat0) * Math.cos(d))
    const lng = lng0 + Math.atan2(Math.sin(d) * Math.cos(lat0), Math.cos(d) - Math.sin(lat0) * Math.sin(lat))
    const p = map.project([(lng * 180) / Math.PI, (lat * 180) / Math.PI])
    r = Math.max(r, Math.hypot(p.x - cp.x, p.y - cp.y))
  }
  const { clientWidth: w, clientHeight: h } = map.getContainer()
  if (!r || r > Math.hypot(w, h)) {
    rim.style.display = "none"
    return
  }
  rim.style.display = "block"
  rim.style.width = rim.style.height = `${2 * r}px`
  rim.style.transform = `translate(${cp.x - r}px, ${cp.y - r}px)`
}

/* ---- a hairline scale bar from city zoom down, so an empty stretch still reads as distance ---- */
function syncScale() {
  const z = map.getZoom()
  let next = null
  if (z >= 8) {
    const mpp = (40075016.686 * Math.cos((map.getCenter().lat * Math.PI) / 180)) / (512 * 2 ** z)
    const max = mpp * 72
    const pow = 10 ** Math.floor(Math.log10(max))
    const nice = [5, 2, 1].map((f) => f * pow).find((d) => d <= max) ?? pow
    next = { label: nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, px: Math.round(nice / mpp) }
  }
  const sig = next ? `${next.label}:${next.px}` : ""
  const old = scale ? `${scale.label}:${scale.px}` : ""
  if (sig === old) return
  scale = next
  renderCredits()
}

/* ---- credits, the scale bar and the "you" note ---- */

function creditsText() {
  return `Natural Earth${attribution === "streets" ? ", © OpenStreetMap contributors, OpenFreeMap" : coastCredit ? ", © OpenStreetMap contributors" : ""}`
}

function renderCredits() {
  const box = $("credits")
  if (!box) return
  const row = box.querySelector(".credits-row")
  const scaleEl = box.querySelector(".scale")
  const text = box.querySelector(".credits-text")
  const info = box.querySelector(".credits-info")
  // Phones: the scale bar sits beside the info button, row reversed (website creditsClassName).
  row.classList.toggle("phone", !chrome.wide)
  if (scale) {
    scaleEl.hidden = false
    scaleEl.setAttribute("aria-label", `Scale: this bar is ${scale.label}`)
    scaleEl.querySelector(".scale-label").textContent = scale.label
    scaleEl.querySelector(".scale-bar").style.width = `${scale.px}px`
  } else scaleEl.hidden = true
  // Compact credits (phones) live behind an info button, open until the first map gesture.
  info.hidden = chrome.wide
  info.setAttribute("aria-label", creditsOpen ? "Hide map credits" : "Map credits")
  info.setAttribute("aria-expanded", String(creditsOpen))
  text.textContent = creditsText()
  text.hidden = !chrome.wide && !creditsOpen
  text.classList.toggle("pill", !chrome.wide)
  relayout()
}

/** The phone's "You're 13 km south-east of the map centre" (around-app.tsx youHint). */
const WINDS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"]
function windFrom(from, to) {
  const y = to.lat - from.lat
  const x = (to.lng - from.lng) * Math.cos((from.lat * Math.PI) / 180)
  const deg = ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360
  return WINDS[Math.round(deg / 45) % 8]
}
function formatDistance(km) {
  if (km < 1) return `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m`
  if (km < 10) return `${km.toFixed(1)} km`
  return `${Math.round(km).toLocaleString("en-GB")} km`
}

/** Whether the "you" dot (16 px plus its ring) sits wholly in the free part of the map. */
let youHint = null
function syncYou() {
  if (!map) return
  let hint = null
  if (you && map.getZoom() >= 4) {
    const { clientWidth: W, clientHeight: H } = map.getContainer()
    const ins = viewInsets()
    const at = map.project([you.lng, you.lat])
    const R = 12
    const inside = at.x >= ins.left + R && at.x <= W - ins.right - R && at.y >= ins.top + R && at.y <= H - ins.bottom - R && map.getBounds().contains([you.lng, you.lat])
    if (!inside) {
      const c = map.getCenter()
      hint = `You're ${formatDistance(haversineKm(c.lat, c.lng, you.lat, you.lng))} ${windFrom(c, you)} of the map centre`
    }
  }
  const showDot = !!you && !hint
  if (showDot && !youMarker) {
    youMarker = new ml.Marker({ element: youDot(), anchor: "center", opacityWhenCovered: 0 }).setLngLat([you.lng, you.lat]).addTo(map)
    layoutDirty = true
  } else if (!showDot && youMarker) {
    youMarker.remove()
    youMarker = null
    layoutDirty = true
  } else if (showDot && youMarker) youMarker.setLngLat([you.lng, you.lat])
  if (hint !== youHint) {
    youHint = hint
    // Wide screens show the hint in the side panel under the places count (around-app.tsx
    // DesktopPanel), never over the map; phones show it in the note above the sheet.
    post({ type: "youHint", text: hint })
    syncNote()
    relayout()
  }
}

/** The "you" hint over the map: phones only (the website's `note={desktop ? null : youHint}`). */
function syncNote() {
  const note = $("note")
  if (!note) return
  const text = chrome.wide ? null : youHint
  note.hidden = !text
  note.textContent = text || ""
}

function syncTitle() {
  const el = $("title")
  if (!el) return
  let text = "Earth"
  if (selectedArea) text = selectedArea
  else if (map) {
    const c = map.getCenter()
    text = cameraTitle(c.lat, c.lng, map.getZoom())
  }
  if (el.textContent !== text) el.textContent = text
}

/* ---- wide screens: zoom and reset-north controls (the website's desktop control column) ---- */
function syncControls() {
  const box = $("controls")
  if (!box) return
  box.hidden = !chrome.wide
  const north = $("north")
  if (!map || !north) return
  const bearing = map.getBearing()
  north.hidden = Math.abs(bearing) <= 0.5
  north.querySelector("svg").style.transform = `rotate(${-bearing}deg)`
}

/** Screen boxes of every pin, cluster (with its count chip) and the "you" dot. */
function markerRects(visibleOnly) {
  const out = []
  const box = (at, w, h, pad) => ({ x: at.x - w / 2 - pad, y: at.y - h / 2 - pad, w: w + 2 * pad, h: h + 2 * pad })
  for (const m of markers.values()) {
    if (visibleOnly && m.el.classList.contains("maplibregl-marker-covered")) continue
    if (!m.size) m.size = { w: m.el.offsetWidth || 44, h: m.el.offsetHeight || 44 }
    const at = map.project(m.marker.getLngLat())
    out.push(m.cluster ? { x: at.x - m.size.w / 2 - 3, y: at.y - m.size.h / 2 - 11, w: m.size.w + 18, h: m.size.h + 14 } : box(at, m.size.w, m.size.h, 5))
  }
  if (youMarker) out.push(box(map.project(youMarker.getLngLat()), 22, 22, 4))
  return out
}

function placeCredits() {
  const spots = creditSpots()
  const el = $("credits")
  if (!el || !map) return false
  const { clientWidth: W, clientHeight: H } = map.getContainer()
  const size = { w: el.offsetWidth, h: el.offsetHeight }
  if (!size.w || !size.h) return false
  const i = pickCreditSpot(spots, size, { w: W, h: H }, markerRects(true))
  if (i === creditSpot && el.dataset.wide === String(chrome.wide)) return false
  creditSpot = i
  el.dataset.wide = String(chrome.wide)
  applySpot(el, spots[i], i)
  return true
}

function relayout() {
  layoutDirty = true
  creditsDirty = true
  schedule()
}

function schedule() {
  if (raf || !map) return
  raf = requestAnimationFrame(() => {
    raf = 0
    reconcile()
    syncRim()
    syncScale()
    syncYou()
    syncControls()
    if (layoutDirty) creditsDirty = true
    if (creditsDirty && !map.isMoving()) {
      creditsDirty = false
      if (placeCredits()) layoutDirty = true
    }
    if (layoutDirty) {
      layoutDirty = false
      engine.placeLabels()
    }
  })
}

function pushPlaces() {
  if (!map) return
  const src = map.getSource("places")
  if (src) src.setData(toFeatures(places))
}

/* ---- camera ---- */

function fly(cam, offset) {
  if (!map) {
    pendingCamera = cam
    return
  }
  // Heading for city zoom: fetch that city's coastline during the flight, not after it.
  if (cam.zoom >= COAST_MIN_ZOOM - 1) prefetchCoasts(cam)
  const opts = { center: [cam.lng, cam.lat], zoom: cam.zoom, bearing: 0, pitch: 0, ...(offset ? { offset } : {}) }
  if (cam.animate === false) map.jumpTo(opts)
  else if (reducedMotion()) map.easeTo({ ...opts, duration: 0 })
  else map.flyTo({ ...opts, speed: 1.6, curve: 1.4, essential: false })
}

/** The bounds of what isn't under the screen's chrome, at zoom ≥ 4; else the whole view (website viewOf). */
function innerBounds() {
  const b = map.getBounds()
  let inner = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }
  if (map.getZoom() >= 4) {
    const ins = viewInsets()
    const { clientWidth: w, clientHeight: h } = map.getContainer()
    if (w - ins.left - ins.right > 40 && h - ins.top - ins.bottom > 40) {
      const nw = map.unproject([ins.left, ins.top])
      const se = map.unproject([w - ins.right, h - ins.bottom])
      inner = { west: nw.lng, north: nw.lat, east: se.lng, south: se.lat }
    }
  }
  return inner
}

function cameraIdle(user) {
  if (!map) return
  const c = map.getCenter()
  const b = innerBounds()
  post({ type: "cameraIdle", lat: c.lat, lng: c.lng, zoom: map.getZoom(), west: b.west, south: b.south, east: b.east, north: b.north, user })
}

/* ---- reveal: an opened place's own pin is brought into the free part of the map (around-app.tsx runReveal) ---- */

let reveal = null

function mapEvent(type, ms, kick) {
  return new Promise((resolve) => {
    const finish = (fired) => {
      clearTimeout(timer)
      map.off(type, onEvent)
      resolve(fired)
    }
    const onEvent = () => finish(true)
    const timer = setTimeout(() => finish(false), ms)
    map.on(type, onEvent)
    if (kick) kick()
  })
}

/** The strip of map a selected pin must sit in: under the title, above the sheet, inside the edges. */
function freeBox() {
  const { clientWidth: W, clientHeight: H } = map.getContainer()
  const ins = viewInsets()
  const bottom = chrome.wide ? H - ins.bottom : H - Math.max(chrome.covered, chrome.peek)
  return { left: ins.left, top: ins.top, right: W - ins.right, bottom: Math.max(ins.top + 60, bottom) }
}

function pinClear(r) {
  const free = freeBox()
  if (r.left < free.left + 4 || r.right > free.right - 4 || r.top < free.top + 4 || r.bottom > free.bottom - 4) return false
  for (const id of ["title", "controls"]) {
    const el = $(id)
    if (!el || el.hidden) continue
    const c = el.getBoundingClientRect()
    if (c.width && c.height && Math.min(c.right, r.right) - Math.max(c.left, r.left) > 0.5 && Math.min(c.bottom, r.bottom) - Math.max(c.top, r.top) > 0.5) return false
  }
  return true
}

/** Where place `id` is drawn: its own pin's box, or the zoom at which a cluster lets it go (pinState). */
async function pinState(id, at) {
  if (map.isMoving()) await mapEvent("moveend", 12000)
  const settled = await mapEvent("idle", 4000, () => map.triggerRepaint())
  reconcile()
  const own = markers.get(`p:${id}`)
  if (own && !own.el.classList.contains("maplibregl-marker-covered")) {
    const r = own.el.getBoundingClientRect()
    if (r.width) return { rect: r, clusterZoom: null, inData: true, settled }
  }
  const src = map.getSource("places")
  if (!src) return { rect: null, clusterZoom: null, inData: false, settled }
  const feats = map.querySourceFeatures("places")
  if (feats.some((f) => !f.properties?.cluster && f.properties?.id === id)) return { rect: null, clusterZoom: null, inData: true, settled }
  const target = map.project([at.lng, at.lat])
  const seen = new Set()
  const clusters = []
  for (const f of feats) {
    if (!f.properties?.cluster) continue
    const cid = Number(f.properties.cluster_id)
    if (seen.has(cid)) continue
    seen.add(cid)
    const c = map.project(f.geometry.coordinates)
    clusters.push({ id: cid, count: Number(f.properties.point_count) || 0, d: Math.hypot(c.x - target.x, c.y - target.y) })
  }
  clusters.sort((a, b) => a.d - b.d)
  const holds = async (cid, count) => (await src.getClusterLeaves(cid, count, 0)).some((l) => l.properties?.id === id)
  try {
    for (const c of clusters.slice(0, 8)) {
      if (!(await holds(c.id, c.count))) continue
      let cid = c.id
      for (let depth = 0; depth < 24; depth++) {
        const z = await src.getClusterExpansionZoom(cid)
        let next = null
        for (const k of await src.getClusterChildren(cid)) {
          if (!k.properties?.cluster) {
            if (k.properties?.id === id) return { rect: null, clusterZoom: z, inData: true, settled }
            continue
          }
          const kid = Number(k.properties.cluster_id)
          if (await holds(kid, Number(k.properties.point_count) || 0)) {
            next = kid
            break
          }
        }
        if (next === null) return { rect: null, clusterZoom: z, inData: true, settled }
        cid = next
      }
      return { rect: null, clusterZoom: null, inData: true, settled }
    }
  } catch (_) {
    return { rect: null, clusterZoom: null, inData: false, settled: false }
  }
  return { rect: null, clusterZoom: null, inData: false, settled }
}

/** The offset that puts a target in the middle of the free strip instead of the padded centre. */
function freeOffset() {
  const { clientWidth: W, clientHeight: H } = map.getContainer()
  const pad = padding()
  const free = freeBox()
  const cx = pad.left + (W - pad.left - pad.right) / 2
  const cy = pad.top + (H - pad.top - pad.bottom) / 2
  return [Math.round((free.left + free.right) / 2 - cx), Math.round((free.top + free.bottom) / 2 - cy)]
}

async function runReveal(r) {
  for (;;) {
    if (!map || reveal !== r) return
    const st = await pinState(r.id, r.at)
    if (reveal !== r) return
    const zoom = map.getZoom()
    if (st.rect && zoom >= 9 && pinClear(st.rect)) {
      reveal = null
      return
    }
    if (!st.inData) {
      if (!st.settled && r.polls < 5) {
        r.polls += 1
        await new Promise((done) => setTimeout(done, 500))
        continue
      }
      const at = map.project([r.at.lng, r.at.lat])
      const spot = { left: at.x - 30, top: at.y - 30, right: at.x + 30, bottom: at.y + 30 }
      if (r.tries >= 3 || (zoom >= 9 && pinClear(spot))) {
        reveal = null
        return
      }
    } else if (r.tries >= 3) {
      reveal = null
      return
    }
    r.tries += 1
    fly({ lat: r.at.lat, lng: r.at.lng, zoom: Math.max(zoom, 13, st.clusterZoom != null ? st.clusterZoom + 0.05 : 0) }, freeOffset())
  }
}

/* ---- Kotlin → JS ---- */

window.yardGlobe = {
  receive(msg) {
    if (!msg || typeof msg !== "object") return
    switch (msg.type) {
      case "places": {
        places = Array.isArray(msg.places) ? msg.places : []
        // Same places, same states: don't re-tile the source (it would redraw every pin).
        const sig = places.map((p) => `${p.id}:${p.status}:${p.markText}:${p.markStyle}`).join(",")
        if (sig === placesSig) return
        placesSig = sig
        leafCache.clear()
        pushPlaces()
        if (fallbackShown) renderFallbackCities()
        return
      }
      case "select": {
        selectedId = msg.id || null
        selectedArea = typeof msg.area === "string" && msg.area ? msg.area : null
        for (const [key, m] of markers) if (key.startsWith("p:")) setPinSelected(m.el, key === `p:${selectedId}`)
        syncTitle()
        if (fallbackShown) renderFallbackCities()
        relayout()
        return
      }
      case "flyTo":
        reveal = null
        fly(msg)
        return
      case "reveal":
        if (!map || typeof msg.lat !== "number" || typeof msg.lng !== "number" || !msg.id) return
        reveal = { id: String(msg.id), at: { lat: msg.lat, lng: msg.lng }, tries: 0, polls: 0 }
        runReveal(reveal)
        return
      case "you":
        you = typeof msg.lat === "number" && typeof msg.lng === "number" ? { lat: msg.lat, lng: msg.lng } : null
        relayout()
        return
      case "chrome": {
        const wasWide = chrome.wide
        const oldPeek = chrome.peek
        chrome = { wide: !!msg.wide, peek: Math.max(0, Number(msg.peek) || 0), covered: Math.max(0, Number(msg.covered) || 0) }
        document.documentElement.classList.toggle("wide", chrome.wide)
        if (map && (wasWide !== chrome.wide || oldPeek !== chrome.peek)) {
          map.setPadding(padding())
          if (wasWide !== chrome.wide) applyGestures()
        }
        syncNote()
        renderCredits()
        if (fallbackShown) layoutFallback()
        return
      }
      case "motion":
        reducedFlag = !!msg.reduced
        document.documentElement.classList.toggle("reduce-motion", reducedFlag)
        return
    }
  },
}

/* ---- OpenFreeMap streets: progressive enhancement that fails quietly ---- */

const OFM_LAYERS = ["ofm-water", "ofm-park", "ofm-landuse", "ofm-roads-minor", "ofm-roads-major", "ofm-roads-motorway", "ofm-buildings", "ofm-places"]
let ofmErrors = 0

function dropStreets() {
  for (const id of OFM_LAYERS) if (map.getLayer(id)) map.removeLayer(id)
  if (map.getSource("ofm")) map.removeSource("ofm")
  if (map.getLayer("area-rings")) map.setPaintProperty("area-rings", "line-opacity", ringOpacity(RING_OPACITY))
  map.setMaxZoom(BUNDLED_MAX_ZOOM)
  attribution = "base"
  renderCredits()
  post({ type: "streets", state: "failed" })
}

async function enhance() {
  post({ type: "streets", state: "loading" })
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 4000)
  try {
    const res = await fetch(STYLE_URL, { signal: ctrl.signal, credentials: "omit", referrerPolicy: "no-referrer" })
    if (!res.ok) throw new Error(String(res.status))
    const style = await res.json()
    clearTimeout(timer)
    const vector = Object.values(style.sources || {}).find((s) => s.type === "vector")
    if (!vector || (!vector.url && !vector.tiles)) throw new Error("no vector source")
    map.addSource("ofm", { type: "vector", ...(vector.url ? { url: vector.url } : { tiles: vector.tiles }), ...(vector.maxzoom ? { maxzoom: vector.maxzoom } : {}) })
    // Streets go under Yard's own area rings, dots and pins.
    const before = "area-rings"
    const fill = (id, layer, color, filter, minzoom = 5) =>
      map.addLayer({ id, type: "fill", source: "ofm", "source-layer": layer, minzoom, ...(filter ? { filter } : {}), paint: { "fill-color": color } }, before)
    const line = (id, classes, color, width) =>
      map.addLayer({ id, type: "line", source: "ofm", "source-layer": "transportation", minzoom: 5, filter: ["in", ["get", "class"], ["literal", classes]], paint: { "line-color": color, "line-width": ["interpolate", ["linear"], ["zoom"], 8, width * 0.4, 16, width * 3] } }, before)
    fill("ofm-water", "water", OCEAN)
    fill("ofm-park", "park", "#121614")
    fill("ofm-landuse", "landuse", "#161519", ["==", ["get", "class"], "residential"])
    line("ofm-roads-minor", ["minor", "service", "tertiary"], "#232228", 0.8)
    line("ofm-roads-major", ["primary", "secondary", "trunk"], "#2c2a33", 1.2)
    line("ofm-roads-motorway", ["motorway"], "#35323d", 1.6)
    fill("ofm-buildings", "building", "#1d1c22", undefined, 14)
    // Place names only when the style's glyphs answer within 2 s.
    if (style.glyphs) {
      const g = new AbortController()
      const gt = setTimeout(() => g.abort(), 2000)
      const ok = await fetch(style.glyphs.replace("{fontstack}", encodeURIComponent("Noto Sans Regular")).replace("{range}", "0-255"), { signal: g.signal, credentials: "omit", referrerPolicy: "no-referrer" })
        .then((r) => r.ok)
        .catch(() => false)
      clearTimeout(gt)
      if (ok) {
        map.setGlyphs(style.glyphs)
        map.addLayer(
          {
            id: "ofm-places",
            type: "symbol",
            source: "ofm",
            "source-layer": "place",
            minzoom: 5,
            // Yard's own gazetteer names stay the labels for its areas; the street map's own
            // place names are quieter and never repeat one of them.
            filter: ["!", ["in", ["coalesce", ["get", "name:en"], ["get", "name"]], ["literal", gazetteerNames]]],
            layout: { "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]], "text-font": ["Noto Sans Regular"], "text-size": 10 },
            paint: { "text-color": "#6b6b70", "text-halo-color": "#080808", "text-halo-width": 1 },
          },
          before,
        )
      }
    }
    // With streets under them, the area rings step back.
    if (map.getLayer("area-rings")) map.setPaintProperty("area-rings", "line-opacity", ringOpacity(RING_OPACITY_STREETS))
    // Streets have detail to the door, so the map may come closer now.
    map.setMaxZoom(STREETS_MAX_ZOOM)
    attribution = "streets"
    renderCredits()
    post({ type: "streets", state: "ready" })
  } catch (_) {
    clearTimeout(timer)
    post({ type: "streets", state: "failed" })
  }
}

/* ---- the map without WebGL (svg-fallback.tsx) ---- */

const FB = { y: 30, w: 1000, h: 400, pin: 44 }

function showFallback(reason) {
  if (fallbackShown) return
  fallbackShown = true
  post({ type: "fallback", reason })
  for (const id of ["map", "rim", "credits", "controls", "title"]) {
    const el = $(id)
    if (el) el.hidden = true
  }
  const fig = $("fallback")
  fig.hidden = false
  landPath()
    .then((d) => {
      $("fallback-land").setAttribute("d", d)
    })
    .catch(() => {
      $("fallback-failed").hidden = false
    })
  layoutFallback()
}

function layoutFallback() {
  const fig = $("fallback")
  if (!fig || fig.hidden) return
  // Centred in the part of the screen the sheet leaves free.
  fig.style.bottom = `${chrome.wide ? 0 : Math.round(chrome.peek)}px`
  renderFallbackCities()
}

function renderFallbackCities() {
  const box = $("fallback-box")
  const svg = $("fallback-svg")
  if (!box || !svg) return
  for (const b of box.querySelectorAll("button")) b.remove()
  const width = svg.getBoundingClientRect().width
  const m = new Map()
  for (const p of places) {
    const g = m.get(p.citySlug) || { slug: p.citySlug, city: p.city, lat: 0, lng: 0, count: 0, sample: true }
    g.lat += p.lat
    g.lng += p.lng
    g.count += 1
    g.sample = g.sample && !!p.sample
    m.set(p.citySlug, g)
  }
  const groups = [...m.values()].map((g) => ({ ...g, lat: g.lat / g.count, lng: g.lng / g.count }))
  const x = (lng) => ((lng + 180) / 360) * 1000
  const y = (lat) => ((90 - lat) / 180) * 500
  // Greedy merge in screen px, biggest city first, so no city's button sits under another's.
  const scaleF = width ? width / FB.w : 0
  const clusters = []
  for (const g of groups.sort((a, b) => b.count - a.count || a.city.localeCompare(b.city))) {
    const px = x(g.lng)
    const py = y(g.lat) - FB.y
    const hit = scaleF ? clusters.find((c) => Math.hypot((c.px - px) * scaleF, (c.py - py) * scaleF) < FB.pin) : undefined
    if (hit) {
      hit.px = (hit.px * hit.count + px * g.count) / (hit.count + g.count)
      hit.py = (hit.py * hit.count + py * g.count) / (hit.count + g.count)
      hit.cities.push(g)
      hit.count += g.count
      hit.sample = hit.sample && g.sample
    } else clusters.push({ cities: [g], count: g.count, sample: g.sample, px, py })
  }
  const selected = places.find((p) => p.id === selectedId)
  const nameOf = (c) => {
    const names = c.cities.map((g) => g.city)
    return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
  }
  for (const c of clusters) {
    const b = document.createElement("button")
    b.type = "button"
    b.className = "fallback-city" + (c.sample ? " sample" : "") + (selected && c.cities.some((g) => g.slug === selected.citySlug) ? " selected" : "")
    b.style.left = `${(c.px / FB.w) * 100}%`
    b.style.top = `${(c.py / FB.h) * 100}%`
    b.textContent = String(c.count)
    b.setAttribute("aria-label", `${nameOf(c)}, ${c.count} ${c.count === 1 ? "place" : "places"}${c.sample ? ", sample" : ""}`)
    b.setAttribute("aria-pressed", String(b.classList.contains("selected")))
    b.addEventListener("click", () => post({ type: "cityTapped", slug: c.cities[0].slug }))
    box.append(b)
  }
}

/* ---- start ---- */

let applyGestures = () => {}

async function start() {
  $("credits").querySelector(".credits-info").addEventListener("click", () => {
    creditsOpen = !creditsOpen
    renderCredits()
  })
  // Kotlin queues its messages until this arrives, then replays the current state.
  post({ type: "ready" })
  try {
    const gaz = await getJson("data/gazetteer.json")
    cities = gaz.cities || []
    gazetteerNames = cities.flatMap((c) => [c.name, ...c.neighbourhoods.map((h) => h.name)])
  } catch (_) {
    cities = []
  }
  if (!hasWebgl2()) return showFallback("webgl")
  let world
  try {
    world = await loadWorld()
  } catch (_) {
    return showFallback("error")
  }
  ml.setWorkerUrl(new URL("vendor/maplibre-gl-worker.js", location.href).href)
  const cam = pendingCamera || { lat: 12, lng: 15, zoom: chrome.wide ? 2.1 : 1.6 }
  pendingCamera = null
  // Opening at city zoom: fetch that city's coastline alongside, so the coarse outline barely shows.
  if (cam.zoom >= COAST_MIN_ZOOM - 1) prefetchCoasts(cam)
  try {
    map = new ml.Map({
      container: "map",
      style: baseStyle(world, areaFeatures()),
      center: [cam.lng, cam.lat],
      zoom: cam.zoom,
      minZoom: 0.8,
      maxZoom: BUNDLED_MAX_ZOOM,
      maxPitch: 60,
      dragRotate: chrome.wide,
      pitchWithRotate: chrome.wide,
      touchPitch: false,
      attributionControl: false,
      renderWorldCopies: false,
      fadeDuration: reducedMotion() ? 0 : 200,
    })
  } catch (_) {
    return showFallback("error")
  }
  // Phones don't rotate (the website's max-width 1023px); wide screens do, with a reset-north button.
  applyGestures = () => {
    if (chrome.wide) {
      map.dragRotate.enable()
      map.touchZoomRotate.enableRotation()
    } else {
      map.dragRotate.disable()
      map.touchZoomRotate.disableRotation()
      if (map.getBearing() !== 0) map.setBearing(0)
    }
  }
  applyGestures()
  map.setPadding(padding())
  window.__yardAroundMap = map

  map.on("error", (ev) => {
    if (ev && ev.sourceId === "ofm") {
      ofmErrors += 1
      if (ofmErrors === 3) dropStreets()
      return
    }
    if (/webgl/i.test((ev && ev.error && ev.error.message) || "")) showFallback("webgl")
  })
  map.on("webglcontextlost", () => showFallback("webgl"))

  /* ---- city coastlines: from the APK's assets when the camera nears a covered city ---- */
  const coasts = new Map()
  const requested = new Set()
  engine.syncCoastCredit = () => {
    let on = false
    if (map.getZoom() >= COAST_MIN_ZOOM && coasts.size) {
      const b = map.getBounds()
      on = [...coasts.values()].some((c) => !(c.bbox[2] < b.getWest() || c.bbox[0] > b.getEast() || c.bbox[3] < b.getSouth() || c.bbox[1] > b.getNorth()))
    }
    if (on !== coastCredit) {
      coastCredit = on
      renderCredits()
    }
  }
  const pushCoasts = () => {
    const list = [...coasts.values()]
    const set = (id, features) => map.getSource(id)?.setData({ type: "FeatureCollection", features })
    set(
      "coast-mask",
      list.map((c) => {
        const [w, s, e, n] = c.bbox
        return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } }
      }),
    )
    set("coast-land", list.flatMap((c) => c.land))
    set("coast-water", list.flatMap((c) => c.water))
    set("coast-shore", list.map((c) => c.shore))
    engine.syncCoastCredit()
  }
  engine.ensureCoasts = () => {
    if (map.getZoom() < COAST_MIN_ZOOM - 1) return
    const c = map.getCenter()
    for (const city of cities) {
      if (requested.has(city.slug) || !COAST_SLUGS.has(city.slug) || haversineKm(c.lat, c.lng, city.lat, city.lng) > 160) continue
      requested.add(city.slug)
      loadCoast(city.slug)
        .then((cc) => {
          coasts.set(cc.slug, cc)
          pushCoasts()
        })
        .catch(() => requested.delete(city.slug))
    }
  }

  /* ---- area labels from the gazetteer, placed clear of pins ---- */
  const label = (slug, text, level, lng, lat) => {
    const el = areaLabel(text, level)
    el.style.zIndex = "1"
    const off = [0, 14]
    return { slug, marker: new ml.Marker({ element: el, anchor: "center", offset: off, opacityWhenCovered: 0 }).setLngLat([lng, lat]), el, lngLat: [lng, lat], off }
  }
  const cityLabels = []
  const hoodLabels = []
  for (const c of cities) {
    cityLabels.push(label(c.slug, c.name, "city", c.lng, c.lat))
    for (const h of c.neighbourhoods) hoodLabels.push(label(`${c.slug}/${h.slug}`, h.name, "neighbourhood", h.lng, h.lat))
  }
  const hiddenAreas = new Set()
  const setAreaHidden = (slug, hidden) => {
    if (hidden === hiddenAreas.has(slug)) return
    if (hidden) hiddenAreas.add(slug)
    else hiddenAreas.delete(slug)
    for (const source of ["area-rings", "area-dots"]) if (map.getSource(source)) map.setFeatureState({ source, id: slug }, { hidden })
  }
  let shown = "none"
  engine.syncLabels = () => {
    const z = map.getZoom()
    const want = z >= HOOD_ZOOM ? "hood" : z >= 4 ? "city" : "none"
    if (want === shown) return
    shown = want
    layoutDirty = true
    for (const l of cityLabels) {
      if (want === "city") l.marker.addTo(map)
      else l.marker.remove()
    }
    for (const l of hoodLabels) {
      if (want === "hood") l.marker.addTo(map)
      else l.marker.remove()
    }
    for (const l of want === "hood" ? cityLabels : want === "city" ? hoodLabels : [...cityLabels, ...hoodLabels]) setAreaHidden(l.slug, false)
  }
  engine.placeLabels = () => {
    const active = shown === "city" ? cityLabels : shown === "hood" ? hoodLabels : []
    if (!active.length) return
    const { clientWidth: W, clientHeight: H } = map.getContainer()
    const obstacles = markerRects(false)
    // Solid chrome (the title, the credits, the controls) hides what's under it; the sheet's band
    // has gaps above its peek, so it's only a preference.
    const hard = []
    const soft = []
    const ins = labelInsets()
    if (ins.top) hard.push({ x: 0, y: 0, w: W, h: ins.top })
    if (ins.bottom) soft.push({ x: 0, y: H - ins.bottom, w: W, h: ins.bottom })
    const host = map.getContainer().getBoundingClientRect()
    const rectOf = (el, pad) => {
      const r = el.getBoundingClientRect()
      return r.width && r.height ? { x: r.left - host.left - pad, y: r.top - host.top - pad, w: r.width + 2 * pad, h: r.height + 2 * pad } : null
    }
    const cr = rectOf($("credits"), 4)
    if (cr) hard.push(cr)
    for (const id of ["title", "controls"]) {
      const el = $(id)
      if (!el || el.hidden) continue
      const r = rectOf(el, 6)
      if (r) hard.push(r)
    }
    const placed = [...hard, ...soft]
    for (const l of active) {
      const at = map.project(l.lngLat)
      if (at.x < -200 || at.x > W + 200 || at.y < -100 || at.y > H + 100) continue
      if (!l.size) {
        const w = l.el.offsetWidth
        if (!w) continue
        l.size = { w, h: l.el.offsetHeight }
      }
      const { offset, rect } = placeLabel(at, l.size, obstacles, placed, { w: W, h: H })
      placed.push(rect)
      if (offset[0] !== l.off[0] || offset[1] !== l.off[1]) {
        l.off = offset
        l.marker.setOffset(offset)
      }
      // A name whose every spot is mostly under the chrome or off screen is left out.
      const area = rect.w * rect.h
      let hidden = area - overlap(rect, { x: 0, y: 0, w: W, h: H })
      for (const c of hard) hidden += overlap(rect, c)
      const under = hidden > area * 0.4
      if (under !== l.el.hasAttribute("data-under-chrome")) l.el.toggleAttribute("data-under-chrome", under)
      const centreUnder = hard.some((c) => at.x >= c.x && at.x <= c.x + c.w && at.y >= c.y && at.y <= c.y + c.h)
      setAreaHidden(l.slug, under || centreUnder)
    }
  }

  map.on("load", () => {
    engine.syncLabels()
    pushPlaces()
    syncTitle()
    renderCredits()
    cameraIdle(false)
    engine.ensureCoasts()
    enhance()
    // Area names are measured once the brand faces are in, so their boxes are the real ones.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => {
      for (const l of [...cityLabels, ...hoodLabels]) l.size = undefined
      for (const m of markers.values()) m.size = undefined
      relayout()
    })
  })
  map.on("zoom", () => {
    engine.syncLabels()
    layoutDirty = true
  })
  map.on("resize", () => {
    layoutDirty = true
    creditsDirty = true
  })
  map.on("render", schedule)
  map.on("sourcedata", (e) => {
    if (e.sourceId === "places") schedule()
  })
  map.on("movestart", (e) => {
    if (!e.originalEvent) return
    // The shopper took the map: compact credits fold away and no camera move of ours follows.
    reveal = null
    if (creditsOpen && !chrome.wide) {
      creditsOpen = false
      renderCredits()
    }
  })
  map.on("moveend", (e) => {
    engine.ensureCoasts()
    engine.syncCoastCredit()
    syncTitle()
    creditsDirty = true
    schedule()
    cameraIdle(!!e.originalEvent)
  })

  $("zoom-in").addEventListener("click", () => map.easeTo({ zoom: map.getZoom() + 1, duration: reducedMotion() ? 0 : 300 }))
  $("zoom-out").addEventListener("click", () => map.easeTo({ zoom: map.getZoom() - 1, duration: reducedMotion() ? 0 : 300 }))
  $("north").addEventListener("click", () => map.resetNorthPitch({ duration: reducedMotion() ? 0 : 300 }))
}

start()
