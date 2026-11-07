import { holidaysQuery } from "@/lib/api/contracts/admin"
import { route } from "@/server/http/route"
import { listHolidays } from "@/server/moderation"

/** GET /api/admin/holidays?country=NG: the calendar the delivery estimates read. */
export const GET = route({ auth: "admin", permission: "shipping.view", query: holidaysQuery }, async ({ query }) => ({ items: await listHolidays(query.country) }))
