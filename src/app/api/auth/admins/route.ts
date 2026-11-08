import { createAdminAccount } from "@/server/auth/admins"
import { adminCreateBody } from "@/server/auth/contracts"
import { metaOf } from "@/server/auth/http"
import { requireRecentReauth } from "@/server/auth/reauth"
import { json, route } from "@/server/http/route"

/**
 * POST /api/auth/admins { email, name, role } → 201 { admin }. Owner admins only, re-auth in the
 * last 5 minutes. Emails a 72-hour "set your password" link; TOTP enrolment happens at first sign-in.
 */
export const POST = route({ auth: "admin", permission: "any_admin", body: adminCreateBody, maxBody: 2 * 1024 }, async ({ req, actor, body, ipHash }) => {
  await requireRecentReauth(actor, 300)
  return json(await createAdminAccount(actor, body, metaOf(req, ipHash)), 201)
})
