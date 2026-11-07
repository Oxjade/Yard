import { holidaysQuery } from "@/lib/api/contracts/shipping"
import { route } from "@/server/http/route"
import { holidaysBetweenDates } from "@/server/shipping/profile"

/** GET /api/shipping/holidays?country&from&to (public, §6.5): the holidays and carrier closures estimates skip. */
export const GET = route(
  { auth: "public", query: holidaysQuery, rate: { key: "shipping.holidays", limit: 120, windowSec: 60, anonGlobal: 6000 } },
  async ({ query }) => ({ country: query.country, items: await holidaysBetweenDates(query.country, query.from, query.to) }),
)
