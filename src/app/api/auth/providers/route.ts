import { providerStatus } from "@/server/auth/oauth/providers"
import { getEnv } from "@/server/env"
import { route } from "@/server/http/route"

/**
 * GET /api/auth/providers → { password: true, magicLink: true, google, apple, demo: { shopper, brand, admin } }.
 * google/apple are false when their keys are missing: hide those buttons rather than showing a broken one.
 */
export const GET = route({ rate: { key: "auth.providers", limit: 120, windowSec: 60, anonGlobal: 6000 }, auth: "public" }, async () => {
  const p = providerStatus()
  const demo = getEnv().demoAuth
  return { password: true, magicLink: true, google: p.google, apple: p.apple, demo: { shopper: demo.shopper, brand: demo.brand, admin: demo.admin } }
})
