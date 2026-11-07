import { z } from "zod"
import { route } from "@/server/http/route"
import { serveMedia } from "@/server/media/serve"

/**
 * GET /api/media/[id]?as=shopper|brand|admin (§5.4 step 9). Public media needs no cookie; private
 * media reads only the `as` cookie (DTO builders append it). Unknown or not-yours is 404. Other
 * query keys (a cache-buster) are ignored; `as` sent twice is refused by route().
 */
const query = z.object({ as: z.enum(["shopper", "brand", "admin"]).optional() })

const handler = route({ auth: "public", query }, async ({ req, params, query: q }) => serveMedia(req, params.id ?? "", q.as ?? null))

export const GET = handler
export const HEAD = handler
