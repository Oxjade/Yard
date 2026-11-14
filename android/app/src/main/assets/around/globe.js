// Yard Around globe for Android: a port of the website's map engine
// (src/components/around/map/around-map.tsx, pins.ts, world-data.ts) onto the same MapLibre GL JS
// 6.16.0 build, loaded from the APK's assets. The bundled Natural Earth land on a dark globe with a
// grey hairline rim; brand pins and clusters are DOM markers hidden on the far side; OpenFreeMap
// streets are a quiet enhancement that fails silently.
//
// Bridge (AroundGlobeBridge.kt):
//   Kotlin → JS  window.yardGlobe.receive({type, …})
//     places {places:[{id,lat,lng,brand,mark,logo,kind,area,status,sample}]}
//     select {id|null}   flyTo {lat,lng,zoom,animate}   you {lat,lng} | {}
//   JS → Kotlin  YardAndroid.post(JSON)
//     ready · placeTapped {id} · cameraIdle {lat,lng,zoom,west,south,east,north,user} ·
//     streets {state} · fallback {reason}

import * as ml from "./vendor/maplibre-gl.js"

const OCEAN = "#060609"
const LAND = "#1d1c24"
const BUNDLED_MAX_ZOOM = 14.5
const STREETS_MAX_ZOOM = 18
const STYLE_URL = "https://tiles.openfreemap.org/styles/dark"
const EMPTY = { type: "FeatureCollection", features: [] }

const post = (msg) => {
  try {
    if (window.YardAndroid) window.YardAndroid.post(JSON.stringify(msg))
  } catch (_) {
    /* the host went away */
  }
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches

function hasWebgl2() {
  try {
    return !!document.createElement("canvas").getContext("webgl2")
  } catch (_) {
    return false
  }
}

/* ---- Natural Earth (world-data.ts) ---- */

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
  const get = (f) => fetch(`vendor/${f}`).then((r) => {
    if (!r.ok) throw new Error(`${f}: ${r.status}`)
    return r.json()
  })
  const [landTopo, countriesTopo] = await Promise.all([get("land-50m.json"), get("countries-110m.json")])
  const topo = window.topojson
  const land = topo.feature(landTopo, landTopo.objects.land)
  const borderMesh = topo.mesh(countriesTopo, countriesTopo.objects.countries, (a, b) => a !== b)
  return {
    land,
    coast: { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: splitAtJumps(ringsOf(land)) } },
    borders: { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: splitAtJumps(borderMesh.coordinates) } },
  }
}

/* ---- the base style (around-map.tsx baseStyle) ---- */

function baseStyle(world) {
  return {
    version: 8,
    projection: { type: "globe" },
    sky: { "sky-color": "#080808", "horizon-color": "#121212", "fog-color": "#080808", "atmosphere-blend": 0 },
    sources: {
      land: { type: "geojson", data: world.land },
      coast: { type: "geojson", data: world.coast },
      borders: { type: "geojson", data: world.borders },
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
      { id: "borders", type: "line", source: "borders", paint: { "line-color": "rgba(245,245,245,0.07)", "line-width": 0.5 } },
      { id: "places-hit", type: "circle", source: "places", paint: { "circle-radius": 22, "circle-opacity": 0 } },
    ],
  }
}

/* ---- pins (pins.ts) ---- */

function markInto(el, p) {
  el.textContent = p.mark || ""
  if (!p.logo) return
  const img = document.createElement("img")
  img.alt = ""
  img.decoding = "async"
  img.referrerPolicy = "no-referrer"
  img.onload = () => {
    el.textContent = ""
    el.append(img)
  }
  img.src = p.logo
}

function placePin(p, onTap) {
  const el = document.createElement("button")
  el.type = "button"
  el.className = "yard-pin" + (p.sample ? " sample" : "")
  el.dataset.placeId = p.id
  el.setAttribute("aria-label", `${p.brand}, ${p.kind}, ${p.area}${p.sample ? ", sample" : ""}`)
  const mark = document.createElement("span")
  mark.className = "yard-mark"
  mark.setAttribute("aria-hidden", "true")
  markInto(mark, p)
  const dot = document.createElement("span")
  dot.className = `yard-dot ${p.status}`
  dot.setAttribute("aria-hidden", "true")
  el.append(mark, dot)
  el.style.zIndex = "2"
  el.addEventListener("click", (e) => {
    e.stopPropagation()
    onTap(p.id)
  })
  return el
}

function setPinSelected(el, selected) {
  el.classList.toggle("selected", selected)
  el.style.zIndex = selected ? "3" : "2"
  if (selected) el.setAttribute("aria-pressed", "true")
  else el.removeAttribute("aria-pressed")
}

function stackCircle(leaf) {
  const c = document.createElement("span")
  c.className = "yard-circle"
  c.setAttribute("aria-hidden", "true")
  if (leaf) markInto(c, leaf)
  return c
}

function countChip(count) {
  const chip = document.createElement("span")
  chip.className = "yard-count"
  chip.setAttribute("aria-hidden", "true")
  chip.dataset.count = ""
  chip.textContent = String(count)
  return chip
}

function clusterPin(count, onTap) {
  const el = document.createElement("button")
  el.type = "button"
  el.className = "yard-cluster"
  el.setAttribute("aria-label", `${count} places here. Zoom in`)
  el.style.zIndex = "2"
  const stack = document.createElement("span")
  stack.className = "yard-stack"
  for (let i = 0; i < Math.min(3, count); i++) {
    const c = stackCircle(null)
    c.style.zIndex = String(3 - i)
    stack.append(c)
  }
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
  const circles = distinct.slice(0, 3).map((l, i) => {
    const c = stackCircle(l)
    c.style.zIndex = String(3 - i)
    return c
  })
  stack.replaceChildren(...circles)
  if (count > circles.length && !el.querySelector("[data-count]")) el.append(countChip(count))
  const names = distinct.map((l) => l.brand)
  el.setAttribute("aria-label", `${count} places here${names.length ? `, including ${names.slice(0, 3).join(", ")}` : ""}. Zoom in`)
}

/* ---- the engine ---- */

let map = null
let places = []
let placesSig = ""
let selectedId = null
let pendingCamera = null
let you = null
let youMarker = null
const markers = new Map()
const leafCache = new Map()
let raf = 0

function toFeatures(list) {
  return {
    type: "FeatureCollection",
    features: list.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      properties: { id: p.id, brand: p.brand, mark: p.mark, logo: p.logo || "", kind: p.kind, area: p.area, status: p.status, sample: !!p.sample },
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
        leaves = src.getClusterLeaves(clusterId, 10, 0).then((ls) => ls.map((l) => ({ mark: String(l.properties?.mark ?? ""), logo: String(l.properties?.logo ?? ""), brand: String(l.properties?.brand ?? "") })))
        leafCache.set(key, leaves)
      }
      leaves.then((ls) => fillCluster(el, ls, count)).catch(() => {})
    } else {
      el = placePin(props, (id) => post({ type: "placeTapped", id }))
      setPinSelected(el, props.id === selectedId)
    }
    const marker = new ml.Marker({ element: el, anchor: "center", opacityWhenCovered: 0, subpixelPositioning: true }).setLngLat(coords).addTo(map)
    markers.set(key, { marker, el })
  }
  for (const [key, m] of markers) {
    if (!seen.has(key)) {
      m.marker.remove()
      markers.delete(key)
    }
  }
}

function syncRim() {
  const rim = document.getElementById("rim")
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

function schedule() {
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    reconcile()
    syncRim()
  })
}

function pushPlaces() {
  if (!map) return
  const src = map.getSource("places")
  if (src) src.setData(toFeatures(places))
}

function pushYou() {
  if (!map) return
  if (youMarker) {
    youMarker.remove()
    youMarker = null
  }
  if (!you) return
  const el = document.createElement("div")
  el.className = "yard-you"
  el.setAttribute("role", "img")
  el.setAttribute("aria-label", "Your location, on this device only")
  el.style.zIndex = "1"
  youMarker = new ml.Marker({ element: el, anchor: "center", opacityWhenCovered: 0 }).setLngLat([you.lng, you.lat]).addTo(map)
}

function fly(cam) {
  if (!map) {
    pendingCamera = cam
    return
  }
  const opts = { center: [cam.lng, cam.lat], zoom: cam.zoom, bearing: 0, pitch: 0 }
  if (!cam.animate || reducedMotion()) map.jumpTo(opts)
  else map.flyTo({ ...opts, speed: 1.6, curve: 1.4, essential: true })
}

function cameraIdle(user) {
  if (!map) return
  const c = map.getCenter()
  const b = map.getBounds()
  post({ type: "cameraIdle", lat: c.lat, lng: c.lng, zoom: map.getZoom(), west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth(), user })
}

window.yardGlobe = {
  receive(msg) {
    if (!msg || typeof msg !== "object") return
    switch (msg.type) {
      case "places": {
        places = Array.isArray(msg.places) ? msg.places : []
        // Same places, same states: don't re-tile the source (it would redraw every pin).
        const sig = places.map((p) => `${p.id}:${p.status}:${p.logo || ""}`).join(",")
        if (sig === placesSig) return
        placesSig = sig
        leafCache.clear()
        for (const m of markers.values()) m.marker.remove()
        markers.clear()
        pushPlaces()
        return
      }
      case "select": {
        selectedId = msg.id || null
        for (const [key, m] of markers) if (key.startsWith("p:")) setPinSelected(m.el, key === `p:${selectedId}`)
        return
      }
      case "flyTo":
        fly(msg)
        return
      case "you":
        you = typeof msg.lat === "number" && typeof msg.lng === "number" ? { lat: msg.lat, lng: msg.lng } : null
        pushYou()
        return
    }
  },
}

/* ---- OpenFreeMap streets: progressive enhancement that fails quietly ---- */

const OFM_LAYERS = ["ofm-water", "ofm-park", "ofm-landuse", "ofm-roads-minor", "ofm-roads-major", "ofm-roads-motorway", "ofm-buildings", "ofm-places"]
let ofmErrors = 0

function setCredits(streets) {
  const el = document.getElementById("credits")
  if (el) el.textContent = streets ? "Natural Earth, © OpenStreetMap contributors, OpenFreeMap" : "Natural Earth"
}

function dropStreets() {
  for (const id of OFM_LAYERS) if (map.getLayer(id)) map.removeLayer(id)
  if (map.getSource("ofm")) map.removeSource("ofm")
  map.setMaxZoom(BUNDLED_MAX_ZOOM)
  setCredits(false)
  post({ type: "streets", state: "failed" })
}

async function enhance() {
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
    // Streets go under Yard's own pins.
    const before = "places-hit"
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
            layout: { "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]], "text-font": ["Noto Sans Regular"], "text-size": 10 },
            paint: { "text-color": "#6b6b70", "text-halo-color": "#080808", "text-halo-width": 1 },
          },
          before,
        )
      }
    }
    // Streets have detail to the door, so the map may come closer now.
    map.setMaxZoom(STREETS_MAX_ZOOM)
    setCredits(true)
    post({ type: "streets", state: "ready" })
  } catch (_) {
    clearTimeout(timer)
    post({ type: "streets", state: "failed" })
  }
}

/* ---- start ---- */

async function start() {
  // Kotlin queues its messages until this arrives, then replays the current state.
  post({ type: "ready" })
  if (!hasWebgl2()) return post({ type: "fallback", reason: "webgl" })
  let world
  try {
    world = await loadWorld()
  } catch (_) {
    return post({ type: "fallback", reason: "error" })
  }
  ml.setWorkerUrl(new URL("vendor/maplibre-gl-worker.js", location.href).href)
  const cam = pendingCamera || { lat: 12, lng: 15, zoom: 1.6 }
  pendingCamera = null
  try {
    map = new ml.Map({
      container: "map",
      style: baseStyle(world),
      center: [cam.lng, cam.lat],
      zoom: cam.zoom,
      minZoom: 0.8,
      maxZoom: BUNDLED_MAX_ZOOM,
      maxPitch: 60,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: false,
      renderWorldCopies: false,
      fadeDuration: reducedMotion() ? 0 : 200,
    })
  } catch (_) {
    return post({ type: "fallback", reason: "error" })
  }
  map.touchZoomRotate.disableRotation()
  window.__yardAroundMap = map

  map.on("error", (ev) => {
    if (ev && ev.sourceId === "ofm") {
      ofmErrors += 1
      if (ofmErrors === 3) dropStreets()
      return
    }
    if (/webgl/i.test((ev && ev.error && ev.error.message) || "")) post({ type: "fallback", reason: "webgl" })
  })
  map.on("load", () => {
    pushPlaces()
    pushYou()
    cameraIdle(false)
    enhance()
  })
  map.on("render", schedule)
  map.on("sourcedata", (e) => {
    if (e.sourceId === "places") schedule()
  })
  map.on("moveend", (e) => {
    schedule()
    cameraIdle(!!e.originalEvent)
  })
}

start()
