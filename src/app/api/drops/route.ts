import { dropCreateBody, dropListQuery } from "@/server/drops/contracts"
import { createDrop, listPublicDrops } from "@/server/drops/service"
import { json, route } from "@/server/http/route"

/** GET /api/drops?phase=upcoming|live|ended|all&brandId=&limit=&cursor=: published drops (never drafts, cancelled drops or suspended brands). */
export const GET = route({ auth: "public", query: dropListQuery, rate: { key: "drops.list", limit: 120, windowSec: 60, anonGlobal: 3000 }, cache: { public: 30, swr: 60 } }, async ({ query }) => listPublicDrops(query))

/** POST /api/drops: a brand creates a draft drop of its own products (Studio). */
export const POST = route(
  { auth: "brand", permission: "content.publish", body: dropCreateBody, maxBody: 16 * 1024, rate: { key: "drops.create", limit: 20, windowSec: 60, daily: 200 } },
  async ({ actor, body, ipHash }) => json({ drop: await createDrop(actor, body, ipHash) }, 201),
)
