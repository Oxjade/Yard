import { z } from "zod"
import { DELIVERY_TABS } from "@/lib/api/contracts/admin"
import { route } from "@/server/http/route"
import { listDelivery } from "@/server/moderation"

const query = z.object({ tab: z.enum(DELIVERY_TABS).default("late"), country: z.string().regex(/^[A-Z]{2}$/).optional() })

/** GET /api/admin/delivery?tab=late|complaints|exceptions|resolved|holidays */
export const GET = route({ auth: "admin", permission: "shipping.view", query }, async ({ query }) => listDelivery(query.tab, query.country))
