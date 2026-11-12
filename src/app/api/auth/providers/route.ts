import { auth0Connections, providerStatus } from "@/server/auth/oauth/providers"
import { getEnv } from "@/server/env"
import { route } from "@/server/http/route"

/**
 * GET /api/auth/providers → { password: true, magicLink: true, google, apple, auth0, auth0Connections: [{ name, label }], demo: { shopper, brand, admin } }.
 * google/apple/auth0 are false when their keys are missing: hide those buttons rather than showing a broken one.
 * auth0Connections are the Auth0 social connections to show, one "Continue with <label>" button each.
 */
export const GET = route({ rate: { key: "auth.providers", limit: 120, windowSec: 60, anonGlobal: 6000 }, auth: "public" }, async () => {
  const p = providerStatus()
  const demo = getEnv().demoAuth
  return { password: true, magicLink: true, google: p.google, apple: p.apple, auth0: p.auth0, auth0Connections: p.auth0 ? auth0Connections() : [], demo: { shopper: demo.shopper, brand: demo.brand, admin: demo.admin } }
})
