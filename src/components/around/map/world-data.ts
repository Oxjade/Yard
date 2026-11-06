"use client"

import type { Feature, FeatureCollection, Geometry, MultiLineString } from "geojson"
import type { GeometryCollection, Topology } from "topojson-specification"

/**
 * The bundled Natural Earth layer (world-atlas 2.0.2), served by /vendor/world-atlas/* and
 * converted with topojson-client in the browser. It needs no third-party host, so it is the map
 * that renders in this sandbox; OpenFreeMap streets are only an enhancement on top.
 */
const V = "2.0.2"
const cache = new Map<string, Promise<unknown>>()

async function topo(file: "land-50m" | "land-110m" | "countries-110m"): Promise<Topology> {
  let p = cache.get(file)
  if (!p) {
    p = fetch(`/vendor/world-atlas/${file}.json?v=${V}`).then((r) => {
      if (!r.ok) throw new Error(`world-atlas ${file}: ${r.status}`)
      return r.json()
    })
    cache.set(file, p)
    p.catch(() => cache.delete(file))
  }
  return (await p) as Topology
}

export type LandData = { land: FeatureCollection<Geometry>; coast: Feature<MultiLineString>; borders: Feature<MultiLineString> }

/**
 * Natural Earth rings that cross the antimeridian (Fiji, Chukotka) jump from 180° to -180°; drawn
 * as lines, that jump becomes a hairline across the whole globe. Lines are split at every jump.
 */
function splitAtJumps(lines: number[][][]): number[][][] {
  const out: number[][][] = []
  for (const line of lines) {
    let cur: number[][] = []
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

function ringsOf(fc: FeatureCollection<Geometry>): number[][][] {
  const rings: number[][][] = []
  for (const f of fc.features) {
    const g = f.geometry
    if (g.type === "Polygon") rings.push(...(g.coordinates as number[][][]))
    else if (g.type === "MultiPolygon") for (const poly of g.coordinates as number[][][][]) rings.push(...poly)
  }
  return rings
}

export async function loadWorld(resolution: "50m" | "110m" = "50m"): Promise<LandData> {
  const [{ feature, mesh }, landTopo, countriesTopo] = await Promise.all([import("topojson-client"), topo(resolution === "50m" ? "land-50m" : "land-110m"), topo("countries-110m")])
  const landObj = landTopo.objects.land as GeometryCollection
  const countriesObj = countriesTopo.objects.countries as GeometryCollection
  const land = feature(landTopo, landObj) as unknown as FeatureCollection<Geometry>
  const borderMesh = mesh(countriesTopo, countriesObj, (a, b) => a !== b) as MultiLineString
  const borders: Feature<MultiLineString> = { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: splitAtJumps(borderMesh.coordinates) } }
  const coast: Feature<MultiLineString> = { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: splitAtJumps(ringsOf(land)) } }
  return { land, coast, borders }
}

/** Land as one equirectangular SVG path (viewBox 1000×500), for the fallback map. */
export async function landPath(): Promise<string> {
  const { feature } = await import("topojson-client")
  const t = await topo("land-110m")
  const fc = feature(t, t.objects.land as GeometryCollection) as unknown as FeatureCollection<Geometry>
  const x = (lng: number) => ((lng + 180) / 360) * 1000
  const y = (lat: number) => ((90 - lat) / 180) * 500
  const ring = (r: number[][]) => r.map(([lng, lat], i) => `${i ? "L" : "M"}${x(lng).toFixed(1)} ${y(lat).toFixed(1)}`).join("") + "Z"
  let d = ""
  for (const f of fc.features) {
    const g = f.geometry
    if (g.type === "Polygon") for (const r of g.coordinates) d += ring(r)
    else if (g.type === "MultiPolygon") for (const poly of g.coordinates) for (const r of poly) d += ring(r)
  }
  return d
}
