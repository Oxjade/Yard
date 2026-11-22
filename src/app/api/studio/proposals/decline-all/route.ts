import { studioProposalsDeclineAllBody } from "@/server/catalog/contracts"
import { declineProposalsBatch } from "@/server/catalog/proposals"
import { route } from "@/server/http/route"

/**
 * POST /api/studio/proposals/decline-all { ids?: string[], reason?, idempotencyKey } (content.publish):
 * declines the given pending suggestions, or every pending one. Nothing in the catalogue changes.
 * Same key = the first result again. Yard is told once. Audited. → { accepted: string[] (the declined
 * ones), skipped: { id, reason }[], replayed? }.
 */
export const POST = route(
  { auth: "brand", permission: "content.publish", body: studioProposalsDeclineAllBody, maxBody: 16 * 1024, rate: { key: "studio.proposals.batch", limit: 6, windowSec: 60 } },
  async ({ actor, body, ipHash }) => declineProposalsBatch(actor, body, ipHash),
)
