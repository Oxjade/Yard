import { inboxSettingsBody } from "@/lib/api/contracts/inbox"
import { route } from "@/server/http/route"
import { getSettings, setSettings } from "@/server/inbox/service"

/** GET /api/inbox/settings → { readReceipts } (§4.4). */
export const GET = route({ rate: { key: "inbox.settings.read", limit: 60, windowSec: 60 }, auth: "shopper" }, async ({ actor }) => getSettings(actor.userId))

/** PATCH /api/inbox/settings { readReceipts }: off means you send none and see none. */
export const PATCH = route({ auth: "shopper", body: inboxSettingsBody, maxBody: 512, rate: { key: "inbox.settings", limit: 30, windowSec: 60 } }, async ({ actor, body }) => setSettings(actor.userId, body.readReceipts))
