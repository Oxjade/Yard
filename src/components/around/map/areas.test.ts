import { test } from "node:test"
import assert from "node:assert/strict"
import { cities } from "@/lib/around/gazetteer"
import { areaFeatures, neighbourhoodRadiusKm, overlap, placeLabel } from "./areas"

test("every gazetteer neighbourhood gets a ring and a dot; every city a dot", () => {
  const { rings, dots } = areaFeatures()
  const hoods = cities.reduce((n, c) => n + c.neighbourhoods.length, 0)
  assert.equal(rings.features.length, hoods)
  assert.equal(dots.features.length, hoods + cities.length)
  for (const r of rings.features) {
    const c = r.geometry.coordinates
    assert.deepEqual(c[0], c[c.length - 1], `${r.properties.slug} ring is closed`)
  }
})

test("neighbouring rings stay apart: radius is 45% of the nearest sibling, 0.5–1.6 km", () => {
  const lagos = cities.find((c) => c.slug === "lagos")!
  for (const h of lagos.neighbourhoods) {
    const km = neighbourhoodRadiusKm(h.lat, h.lng, lagos.neighbourhoods)
    assert.ok(km >= 0.5 && km <= 1.6, `${h.slug} ${km}`)
  }
})

test("a name moves off a pin sitting on its centroid, and stays on screen", () => {
  const pin = { x: 100 - 27, y: 100 - 27, w: 54, h: 54 }
  const { rect } = placeLabel({ x: 100, y: 100 }, { w: 40, h: 12 }, [pin], [], { w: 400, h: 400 })
  assert.equal(overlap(rect, pin), 0)
  assert.ok(rect.y >= 0 && rect.x >= 0)
  // Near the top edge the name goes below rather than off screen.
  const top = placeLabel({ x: 100, y: 10 }, { w: 40, h: 12 }, [{ x: 73, y: -17, w: 54, h: 54 }], [], { w: 400, h: 400 })
  assert.ok(top.rect.y >= 0)
})

test("a free spot under the centroid's dot is preferred", () => {
  const { offset } = placeLabel({ x: 100, y: 100 }, { w: 40, h: 12 }, [], [], { w: 400, h: 400 })
  assert.deepEqual(offset, [0, 13])
})
