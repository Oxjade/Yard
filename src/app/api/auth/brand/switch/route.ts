import { brandSwitchBody } from "@/server/auth/contracts"
import { brandForUser, profileFor, userById } from "@/server/auth/identity"
import { loadSession, rotate } from "@/server/auth/session"
import { withTx } from "@/server/db"
import { notFound } from "@/server/http/errors"
import { route } from "@/server/http/route"

/**
 * POST /api/auth/brand/switch { brandId } → { actor: "brand", profile }. Switches the active
 * brand of this brand session to another active membership; the token rotates (§2.1).
 */
export const POST = route({ auth: "brand", permission: "any_member", body: brandSwitchBody, maxBody: 1024 }, async ({ actor, body }) => {
  const brandId = await brandForUser(actor.userId, body.brandId)
  const row = await loadSession("brand")
  if (!row) throw notFound()
  await withTx(async () => {
    await rotate("brand", row, { activeBrandId: brandId })
  })
  const user = await userById(actor.userId)
  if (!user) throw notFound()
  return { actor: "brand" as const, profile: await profileFor("brand", user, brandId) }
})
