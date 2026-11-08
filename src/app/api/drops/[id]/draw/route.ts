import { getShopper } from "@/server/auth/dal"
import { drawInfo, drawNow, loadDrop } from "@/server/drops/service"
import { notFound } from "@/server/http/errors"
import { route } from "@/server/http/route"

/** GET /api/drops/{id}/draw: the method, the committed seed hash, the seed once drawn, counts, and the signed-in shopper's own result. */
export const GET = route({ auth: "public", rate: { key: "drops.draw.read", limit: 120, windowSec: 60, anonGlobal: 3000 } }, async ({ params }) => {
  const row = await loadDrop(params.id)
  if (!row) throw notFound("We couldn't find that drop.")
  const me = await getShopper()
  return drawInfo(row, me?.userId ?? null)
})

/** POST /api/drops/{id}/draw: runs the draw now, once entries have closed (the scheduler does this on its own within a minute). */
export const POST = route({ auth: "brand", permission: "content.publish", rate: { key: "drops.draw.run", limit: 10, windowSec: 60 } }, async ({ actor, params, ipHash }) => {
  const row = await loadDrop(params.id, { brandId: actor.brandId })
  if (!row) throw notFound("We couldn't find that drop.")
  return drawNow(actor, row, ipHash)
})
