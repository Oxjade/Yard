import { holidaysQuery } from "@/lib/api/contracts/admin"
import { route } from "@/server/http/route"
import { listHolidays } from "@/server/moderation"

/** GET /api/admin/holidays?country=NG: the calendar the delivery estimates read. */
export const GET = route({ rate: { key: "admin.holidays", limit: 60, windowSec: 60 }, auth: "admin", permission: "shipping.view", query: holidaysQuery }, async ({ query }) => ({ items: await listHolidays(query.country) }))
