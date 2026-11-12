import { route } from "@/server/http/route"
import { listAccounts } from "@/server/social/service"

/** GET /api/studio/social/accounts (any member): one entry per provider, metadata only — never a token. */
export const GET = route({ rate: { key: "studio.social.read", limit: 120, windowSec: 60 }, auth: "brand", permission: "inbox.read" }, async ({ actor }) => listAccounts(actor))
