import { z } from "zod"
import { notFound } from "@/server/http/errors"
import { route } from "@/server/http/route"
import { isDecisionAction, runDecision } from "@/server/moderation"
import { kitRequest } from "@/server/moderation/shared"

/**
 * POST /api/admin/decisions/{action} (§8.2). Kebab-case actions map to camelCase handlers; an
 * unknown action is 404. Each decision checks its own permission, validates a strict body, runs in
 * one transaction with one audit row, and answers { item, audit }.
 */
export const POST = route(
  { auth: "admin", permission: "any_admin", body: z.record(z.string(), z.unknown()), rate: { key: "admin.decide", limit: 120, windowSec: 60 } },
  async ({ req, actor, params, body, ipHash }) => {
    const action = params.action
    if (!isDecisionAction(action)) throw notFound("There's no such decision.")
    return runDecision(action, actor, body, ipHash, kitRequest(req))
  },
)
