import { studioProposalsAcceptAllBody } from "@/server/catalog/contracts"
import { acceptProposalsBatch } from "@/server/catalog/proposals"
import { route } from "@/server/http/route"

/**
 * POST /api/studio/proposals/accept-all { ids?: string[], idempotencyKey } (content.publish):
 * accepts the given pending suggestions, or every pending one without `ids`. Each goes through the
 * single accept in its own transaction; one that fails (validation, or an edit whose product changed
 * since Yard suggested it) stays pending. Same key = the first result again, nothing run twice.
 * Yard is told once for the batch. Audited. → { accepted: string[], skipped: { id, reason }[], replayed? }.
 */
export const POST = route(
  { auth: "brand", permission: "content.publish", body: studioProposalsAcceptAllBody, maxBody: 16 * 1024, rate: { key: "studio.proposals.batch", limit: 6, windowSec: 60 } },
  async ({ actor, body, ipHash }) => acceptProposalsBatch(actor, body, ipHash),
)
