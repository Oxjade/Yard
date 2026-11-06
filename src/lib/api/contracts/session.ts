import { z } from "zod"
import { ADMIN_PERMISSIONS, BRAND_PERMISSIONS } from "@/lib/permissions"
import { actorKind } from "./common"

/** GET /api/session (§2.1): narrow profiles only, never tokens. */
export const shopperProfile = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  status: z.enum(["active", "restricted", "suspended"]),
  demo: z.boolean(),
})
export const brandProfile = z.object({
  userId: z.string(),
  name: z.string(),
  brand: z.object({ id: z.string(), handle: z.string(), name: z.string(), reviewStatus: z.enum(["pending_review", "verified", "restricted", "suspended"]) }),
  role: z.enum(["owner", "admin", "designer", "fulfilment", "finance", "viewer"]),
  permissions: z.array(z.enum(BRAND_PERMISSIONS)),
  demo: z.boolean(),
})
export const adminProfile = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(["owner", "finance", "trust_safety", "support", "ads_ops", "engineering"]),
  permissions: z.array(z.enum(ADMIN_PERMISSIONS)),
  demo: z.boolean(),
})
export const demoAuthState = z.object({ shopper: z.boolean(), brand: z.boolean(), admin: z.boolean(), production: z.boolean() })

export const sessionDto = z.object({
  shopper: shopperProfile.nullable(),
  brand: brandProfile.nullable(),
  admin: adminProfile.nullable(),
  demoAuth: demoAuthState,
})
export type ShopperProfile = z.infer<typeof shopperProfile>
export type BrandProfile = z.infer<typeof brandProfile>
export type AdminProfile = z.infer<typeof adminProfile>
export type DemoAuthState = z.infer<typeof demoAuthState>
export type SessionDto = z.infer<typeof sessionDto>

/** POST /api/auth/demo. `brandId` (brand only) picks the active brand among the account's memberships. */
export const demoSignInBody = z
  .object({
    actor: actorKind,
    account: z.string().min(1).max(40),
    brandId: z.string().min(1).max(40).optional(),
  })
  .strict()
export type DemoSignInBody = z.infer<typeof demoSignInBody>

export const demoSignInResult = z.object({ actor: actorKind, profile: z.union([shopperProfile, brandProfile, adminProfile]) })
export type DemoSignInResult = z.infer<typeof demoSignInResult>

/** DELETE /api/auth/demo?actor= and GET /api/auth/demo?actor= (the picker's accounts). */
export const demoActorQuery = z.object({ actor: actorKind })

export const demoAccountDto = z.object({
  actor: actorKind,
  account: z.string(),
  brandId: z.string().optional(),
  name: z.string(),
  role: z.string(),
  brandName: z.string().optional(),
  note: z.string().optional(),
  /** Listed under "More test accounts". */
  more: z.boolean(),
  /** Why it can't be chosen right now, e.g. "Suspended by Yard". */
  disabledReason: z.string().optional(),
})
export type DemoAccountDto = z.infer<typeof demoAccountDto>
export const demoAccountsResult = z.object({ accounts: z.array(demoAccountDto) })
