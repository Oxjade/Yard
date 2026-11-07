import { onlineBrandsQuery } from "@/lib/api/contracts/around"
import { onlineBrands } from "@/server/around"
import { json, route } from "@/server/http/route"

/**
 * GET /api/around/online-brands?city=berlin (§6.4 List view): brands in the city with no place
 * publicPlaces() returns. Yard only knows nothing is published, so the UI never claims more.
 */
export const GET = route({ auth: "public", query: onlineBrandsQuery, rate: { key: "around.read", limit: 120, windowSec: 60, anonGlobal: 6000 } }, async ({ query }) => {
  const { maxAge, ...out } = await onlineBrands(query.city)
  return json(out, 200, { "Cache-Control": `public, max-age=${maxAge}` })
})
