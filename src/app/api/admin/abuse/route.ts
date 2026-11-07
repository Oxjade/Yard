import { z } from "zod"
import { route } from "@/server/http/route"
import { abuseRowFor, listAbuse } from "@/server/moderation"
import { notFound } from "@/server/http/errors"

const query = z.object({ cursor: z.string().max(200).optional(), user: z.string().max(80).optional() })

/** GET /api/admin/abuse[?user=]: accounts with abuse signals in the last 7 days (§8.1 Users › Abuse). */
export const GET = route({ auth: "admin", permission: "abuse.view", query }, async ({ query }) => {
  if (query.user) {
    const row = await abuseRowFor(query.user)
    if (!row) throw notFound()
    return { items: [row], windowDays: 7, nextCursor: null }
  }
  return listAbuse()
})
