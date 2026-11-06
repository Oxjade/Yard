import { readFile } from "node:fs/promises"
import path from "node:path"

/**
 * GET /vendor/world-atlas/{land-50m,land-110m,countries-110m}.json: Natural Earth TopoJSON from the
 * world-atlas package, for YARD Around's bundled base map (§6.4 map engine step 3). Served as
 * files rather than bundled into a JS chunk, so /around parses them as JSON only when it opens.
 * Only these three files exist here; the version is in the query, so they cache for a year.
 */
const FILES = new Set(["land-50m.json", "land-110m.json", "countries-110m.json"])
const cache = new Map<string, Promise<Buffer>>()

export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params
  if (!FILES.has(file)) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } })
  let p = cache.get(file)
  if (!p) {
    p = readFile(path.join(process.cwd(), "node_modules", "world-atlas", file))
    cache.set(file, p)
    p.catch(() => cache.delete(file))
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
