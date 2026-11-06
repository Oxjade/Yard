import { readFile } from "node:fs/promises"
import path from "node:path"

/**
 * GET /vendor/maplibre-gl-worker.mjs (§6.4 map engine step 2). MapLibre 6 derives its worker URL
 * from the bundle chunk's own URL, which doesn't exist under Turbopack, so the map sets
 * `setWorkerUrl('/vendor/maplibre-gl-worker.mjs?v=6.16.0')` and this serves the package's
 * self-contained worker. The version is in the query, so the file can be cached for a year.
 */
let cached: Promise<Buffer> | null = null
const file = () => (cached ??= readFile(path.join(process.cwd(), "node_modules", "maplibre-gl", "dist", "maplibre-gl-worker.mjs")).catch((e) => {
  cached = null
  throw e
}))

export async function GET() {
  try {
    const body = await file()
    return new Response(new Uint8Array(body), {
      status: 200,
      headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
    })
  } catch {
    return new Response("Map worker unavailable", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } })
  }
}
