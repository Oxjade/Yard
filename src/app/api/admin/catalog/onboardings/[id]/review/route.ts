import { z } from "zod"
import { reviewOnboarding } from "@/server/catalog"
import { route } from "@/server/http/route"

const body = z.strictObject({ decision: z.enum(["approve", "reject"]), note: z.string().max(1000).optional() })

/**
 * POST /api/admin/catalog/onboardings/{id}/review { decision, note? }: approve (the brand becomes
 * verified and can publish) or reject (note required; the applicant edits and resubmits). Audited.
 */
export const POST = route({ auth: "admin", permission: "brands.restrict", body, rate: { key: "admin.onboarding_review", limit: 120, windowSec: 3600 } }, async ({ actor, params, body, ipHash }) =>
  reviewOnboarding(actor, { onboardingId: params.id, decision: body.decision, note: body.note, ipHash }),
)
