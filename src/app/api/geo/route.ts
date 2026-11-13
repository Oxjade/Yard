import { countries } from "@/config/markets"
import { countryOf } from "@/server/geo/country"
import { route } from "@/server/http/route"

/**
 * GET /api/geo: the visitor's country, when it's one Yard sells to (else null), so delivery and
 * currency start from where the shopper is instead of always Nigeria. Looked up from the IP, which
 * isn't stored or returned.
 */
export const GET = route({ auth: "public", rate: { key: "geo", limit: 30, windowSec: 60 }, cache: "no-store" }, async ({ ip }) => {
  const code = await countryOf(ip)
  return { country: code && code in countries ? code : null }
})
