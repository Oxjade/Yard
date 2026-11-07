import { readFile } from "node:fs/promises"
import path from "node:path"
import { cities } from "@/lib/around/gazetteer"

/**
 * GET /vendor/around-coast/<city slug>.json: the covered city's coastline, lakes and river areas
 * (src/lib/around/coast, © OpenStreetMap contributors, ODbL), for YARD Around's bundled map at
 * city and neighbourhood zoom. Only gazetteer cities exist; the map version is in the query, so
 * a file caches for a year. It names a city the map already asked for 1° tiles around.
 */
const FILES = new Set(cities.map((c) => `${c.slug}.json`))
const cache = new Map<string, Promise<Buffer>>()

export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params
  if (!FILES.has(file)) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } })
  let p = cache.get(file)
  if (!p) {
    p = readFile(path.join(process.cwd(), "src", "lib", "around", "coast", file))
    // Development reads the file each time, so a rebuilt extract shows without a restart.
    if (process.env.NODE_ENV === "production") {
      cache.set(file, p)
      p.catch(() => cache.delete(file))
    }
  }
  try {
    const body = await p
    return new Response(new Uint8Array(body), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
    })
  } catch {
    return new Response("Map data unavailable", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } })
  }
}
