import "server-only"
import type { AdminProfile, BrandProfile, SessionDto, ShopperProfile } from "@/lib/api/contracts/session"
import { getEnv } from "../env"
import { getAdmin, getBrandActor, getShopper, type AdminActor, type BrandActor, type ShopperActor } from "./dal"

/** Narrow profiles for GET /api/session and the demo sign-in response (§2.1). Never tokens. */
export const shopperProfileOf = (a: ShopperActor): ShopperProfile => ({ id: a.userId, name: a.name, email: a.email, status: a.status, demo: a.demo })

export const brandProfileOf = (a: BrandActor): BrandProfile => ({
  userId: a.userId,
  name: a.name,
  brand: { id: a.brand.id, handle: a.brand.handle, name: a.brand.name, reviewStatus: a.brand.reviewStatus as BrandProfile["brand"]["reviewStatus"] },
  role: a.role,
  permissions: a.permissions,
  demo: a.demo,
})

export const adminProfileOf = (a: AdminActor): AdminProfile => ({ id: a.userId, name: a.name, role: a.role, permissions: a.permissions, demo: a.demo })

export async function sessionSnapshot(): Promise<SessionDto> {
  const [shopper, brand, admin] = await Promise.all([getShopper(), getBrandActor(), getAdmin()])
  const env = getEnv()
  return {
    shopper: shopper ? shopperProfileOf(shopper) : null,
    brand: brand ? brandProfileOf(brand) : null,
    admin: admin ? adminProfileOf(admin) : null,
    demoAuth: { ...env.demoAuth },
  }
}
