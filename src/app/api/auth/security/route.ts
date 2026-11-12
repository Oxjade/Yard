import { credentialsOf } from "@/server/auth/identity"
import { mfaStatus } from "@/server/auth/mfa"
import { listIdentities } from "@/server/auth/oauth/flow"
import { providerStatus } from "@/server/auth/oauth/providers"
import { reauthAge } from "@/server/auth/reauth"
import { sessionAuthOf } from "@/server/auth/session-auth"
import { deletionStatus } from "@/server/auth/erasure"
import { route } from "@/server/http/route"

/**
 * GET /api/auth/security?as=shopper|brand|admin: the account's sign-in state for settings pages.
 * { method, demo, emailVerified, hasPassword, identities, providers, mfa (admins), reauthAgeSec, deletion (shoppers) }
 */
export const GET = route({ rate: { key: "auth.security", limit: 120, windowSec: 60 }, auth: "multi", as: ["shopper", "brand", "admin"] }, async ({ actor }) => {
  const [cred, how, identities, age] = await Promise.all([credentialsOf(actor.userId), sessionAuthOf(actor.sessionId), listIdentities(actor.userId), reauthAge(actor.sessionId)])
  return {
    method: how?.method ?? "demo",
    demo: actor.demo,
    emailVerified: !!cred?.emailVerifiedAt,
    hasPassword: !!cred?.passwordHash,
    identities,
    providers: providerStatus(),
    mfa: actor.kind === "admin" ? await mfaStatus(actor.userId) : null,
    reauthAgeSec: age,
    deletion: actor.kind === "shopper" ? await deletionStatus(actor.userId) : null,
  }
})
