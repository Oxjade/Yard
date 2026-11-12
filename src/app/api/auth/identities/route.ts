import { listIdentities } from "@/server/auth/oauth/flow"
import { providerStatus } from "@/server/auth/oauth/providers"
import { route } from "@/server/http/route"

/** GET /api/auth/identities?as=shopper|brand → { identities: [{ id, provider, email, createdAt, lastUsedAt }], providers: { google, apple } }. */
export const GET = route({ rate: { key: "auth.identities.read", limit: 60, windowSec: 60 }, auth: "multi", as: ["shopper", "brand"] }, async ({ actor }) => ({ identities: await listIdentities(actor.userId), providers: providerStatus() }))
