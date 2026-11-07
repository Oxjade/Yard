import { placeDetail } from "@/server/around"
import { notFound } from "@/server/http/errors"
import { json, route } from "@/server/http/route"

/**
 * GET /api/around/places/{id} (§6.4): a place publicPlaces() returns, with its live and upcoming
 * events, photos and featured pieces. Anything else (draft, hidden, in review, rejected, removed,
 * ended, or an unlisted brand's) is 404, so existence never leaks.
 */
export const GET = route({ auth: "public", rate: { key: "around.read", limit: 120, windowSec: 60, anonGlobal: 6000 } }, async ({ params }) => {
  const id = params.id ?? ""
  if (!/^loc_[A-Za-z0-9_-]{1,80}$/.test(id)) throw notFound()
  const found = await placeDetail(id)
  if (!found) throw notFound()
  return json({ place: found.place }, 200, { "Cache-Control": `public, max-age=${found.maxAge}` })
})
