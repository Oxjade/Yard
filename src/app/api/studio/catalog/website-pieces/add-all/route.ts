import { studioPiecesAddAllBody } from "@/lib/api/contracts/imports"
import { studioAddPiecesBatch } from "@/server/catalog/importer/watch"
import { route } from "@/server/http/route"

/**
 * POST /api/studio/catalog/website-pieces/add-all { ids?: string[], idempotencyKey } (content.publish):
 * adds the given waiting pieces, or every waiting one, each exactly as "Add to Yard" does (first
 * wins against Yard; a failed piece goes back to waiting with its reason). Same key = the first
 * result again. Audited. → { items, count, mayAdd, site, currency, accepted: string[], skipped: { id, reason }[], replayed? }.
 */
export const POST = route(
  { auth: "brand", permission: "content.publish", body: studioPiecesAddAllBody, maxBody: 16 * 1024, rate: { key: "studio.website_pieces.batch", limit: 6, windowSec: 60 } },
  async ({ actor, body, ipHash }) => studioAddPiecesBatch(actor, body, ipHash),
)
