import { inviteCreateBody } from "@/server/auth/contracts"
import { metaOf } from "@/server/auth/http"
import { createInvite, listInvites } from "@/server/auth/invites"
import { json, route } from "@/server/http/route"

/** GET /api/auth/invites → { invites } for the active brand (any member may read). */
export const GET = route({ rate: { key: "auth.invites.read", limit: 60, windowSec: 60 }, auth: "brand", permission: "any_member" }, async ({ actor }) => ({ invites: await listInvites(actor) }))

/** POST /api/auth/invites { email, role } → 201 { invite }. Owners invite any role; brand admins any role but owner/admin. */
export const POST = route({ rate: { key: "auth.invites.create", limit: 30, windowSec: 600 }, auth: "brand", permission: "any_member", body: inviteCreateBody, maxBody: 2 * 1024 }, async ({ req, actor, body, ipHash }) =>
  json({ invite: await createInvite(actor, body, metaOf(req, ipHash)) }, 201),
)
