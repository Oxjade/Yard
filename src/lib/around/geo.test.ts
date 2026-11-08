import { test } from "node:test"
import assert from "node:assert/strict"
import { areaBySlug } from "./gazetteer"
import { areaCamera, cameraArea, cameraForFix, formatDistance, placesRequestFor } from "./geo"

test("a location fix moves the camera to the area's own camera, never the fix (§5.6)", () => {
  const phone = { w: 286, h: 444 }
  const lagos = cameraForFix(6.46, 3.52, phone)
  assert.equal(lagos.area?.slug, "lagos")
  // Exactly where a manual "Lagos" choice puts it on the same screen.
  assert.deepEqual(lagos.center, areaCamera(areaBySlug("lagos")!, phone).center)
  assert.equal(lagos.zoom, areaCamera(areaBySlug("lagos")!, phone).zoom)
  assert.notDeepEqual([lagos.center.lat, lagos.center.lng], [6.46, 3.52])
  // A phone frames Ikeja to Lekki (zoom 10.4–11.5); a wide screen comes closer.
  assert.ok(lagos.zoom >= 10.4 && lagos.zoom < 11.5)
  assert.ok(areaCamera(areaBySlug("lagos")!, { w: 884, h: 732 }).zoom > lagos.zoom)
  const lekki = cameraForFix(6.45, 3.47)
  assert.equal(lekki.area?.slug, "lagos/lekki")
  assert.equal(lekki.zoom, 13.5)
  const far = cameraForFix(10.5, 20)
  assert.equal(far.area, null)
  assert.ok(far.zoom <= 10)
})

test("the server only ever sees a 3×3 tile block or the world (§5.6)", () => {
  const r = placesRequestFor({ zoom: 11.5, center: { lat: 6.5244, lng: 3.3792 }, bounds: { west: 3.32, east: 3.43, south: 6.42, north: 6.63 } })
  assert.ok("tiles" in r && r.tiles.length === 9 && r.tiles.includes("6_3"))
  assert.ok("scope" in placesRequestFor({ zoom: 2, center: { lat: 0, lng: 0 }, bounds: { west: -180, east: 180, south: -80, north: 80 } }))
  assert.ok("scope" in placesRequestFor({ zoom: 5, center: { lat: 6, lng: 3 }, bounds: { west: -10, east: 15, south: -2, north: 14 } }))
})

test("titles and distances", () => {
  assert.equal(cameraArea(6.4478, 3.4723, 13.5).level, "neighbourhood")
  assert.equal(cameraArea(12, 15, 1.6).level, "earth")
  assert.equal(formatDistance(1.234), "1.2 km")
  assert.equal(formatDistance(0.42), "400 m")
})

test("a small phone frames the city's places when its neighbourhoods can't fit, still the same for a fix and a choice", () => {
  const small = { w: 286, h: 264 } // 390×664: the frame between the header and the pill
  const lagos = areaBySlug("lagos")!
  const places = [
    { lat: 6.5095, lng: 3.3711 },
    { lat: 6.4474, lng: 3.4336 },
    { lat: 6.4478, lng: 3.4723 },
    { lat: 51.52, lng: -0.08 }, // London: not one of Lagos's places
  ]
  const boxOnly = areaCamera(lagos, small)
  const withPlaces = areaCamera(lagos, small, places)
  assert.equal(boxOnly.zoom, 10.4)
  assert.ok(withPlaces.zoom > 10.4 && withPlaces.zoom <= 11.5, String(withPlaces.zoom))
  assert.ok(Math.abs(withPlaces.center.lat - 6.4785) < 0.01 && Math.abs(withPlaces.center.lng - 3.4217) < 0.01, JSON.stringify(withPlaces))
  const fix = cameraForFix(6.46, 3.52, small, places)
  assert.deepEqual({ center: fix.center, zoom: fix.zoom }, withPlaces)
  // Where the neighbourhoods fit (390×844, desktop), the places change nothing.
  assert.deepEqual(areaCamera(lagos, { w: 286, h: 444 }, places), areaCamera(lagos, { w: 286, h: 444 }))
})
