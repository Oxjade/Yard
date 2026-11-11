import { dropCreateBody, dropListQuery } from "@/server/drops/contracts"
import { createDrop, listPublicDrops } from "@/server/drops/service"
import { json, route } from "@/server/http/route"

/** GET /api/drops?phase=upcoming|live|ended|all&source=all|brands&brandId=&limit=&cursor=: published drops (never drafts, cancelled drops, or brands the catalogue hides: restricted, suspended, unlaunched founding). */
export const GET = route({ auth: "public", query: dropListQuery, rate: { key: "drops.list", limit: 120, windowSec: 60, anonGlobal: 3000 }, cache: { public: 30, swr: 60 } }, async ({ query }) => listPublicDrops(query))

/** POST /api/drops: a brand creates a draft drop of its own products (Studio). Needs an Idempotency-Key; a retry with the same key and body returns the same draft. */
export const POST = route(
  { auth: "brand", permission: "content.publish", body: dropCreateBody, maxBody: 16 * 1024, rate: { key: "drops.create", limit: 20, windowSec: 60, daily: 200 } },
  async ({ actor, body, req, ipHash }) => {
    const { drop, replayed } = await createDrop(actor, body, req.headers.get("Idempotency-Key"), ipHash)
    return json({ drop }, replayed ? 200 : 201)
  },
)
