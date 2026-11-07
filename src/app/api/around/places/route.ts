import { placesQuery, tileKey } from "@/lib/api/contracts/around"
import { MAX_TILES, parseTile } from "@/lib/around/geo"
import { listPlaces } from "@/server/around"
import { badRequest } from "@/server/http/errors"
import { json, route } from "@/server/http/route"

/**
 * GET /api/around/places?tiles=6_3,6_4 | ?scope=world (§5.6, §6.4). Public, coarse by design:
 * 1° tiles (at most 12) or the whole world, never a point. Only places publicPlaces() returns.
 */
export const GET = route(
  { auth: "public", query: placesQuery, rate: { key: "around.read", limit: 120, windowSec: 60, anonGlobal: 6000 } },
  async ({ query }) => {
    if (query.tiles && query.scope) throw badRequest({ tiles: "Send tiles or scope=world, not both." })
    if (!query.tiles && !query.scope) throw badRequest({ tiles: "Send tiles=6_3,6_4 or scope=world." })
    let tiles: string[] | undefined
    if (query.tiles) {
      tiles = [...new Set(query.tiles.split(",").map((s) => s.trim()).filter(Boolean))]
      if (!tiles.length) throw badRequest({ tiles: "Send at least one tile." })
      if (tiles.length > MAX_TILES) throw badRequest({ tiles: `Ask for at most ${MAX_TILES} tiles at a time.` })
      if (tiles.some((k) => !tileKey.safeParse(k).success || !parseTile(k))) throw badRequest({ tiles: "Use tiles like 6_3 (latitude_longitude in whole degrees)." })
    }
    const { places, maxAge } = await listPlaces({ tiles, kind: query.kind, category: query.category })
    return json({ places, scope: tiles ? "tiles" : "world" }, 200, { "Cache-Control": `public, max-age=${maxAge}` })
  },
)
