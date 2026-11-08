import { withTx } from "@/server/db"
import { getPreferences, updatePreferences } from "@/server/email"
import { preferencesPatchBody, prefsQuery } from "@/server/follows/contracts"
import { route } from "@/server/http/route"

/**
 * GET /api/notifications/preferences?as=shopper|brand|admin: the signed-in person's optional
 * notification settings (email and in-app: drops, price_drops, back_in_stock, brand_news).
 * Account, order and payout emails are service mail and always sent.
 */
export const GET = route({ auth: "multi", as: ["shopper", "brand", "admin"], query: prefsQuery, rate: { key: "prefs.read", limit: 120, windowSec: 60 } }, async ({ actor }) => ({
  preferences: await getPreferences(actor.userId),
}))

/** PATCH /api/notifications/preferences?as= { email?: {…}, inApp?: {…} }: turning an email category back on lifts an earlier unsubscribe. */
export const PATCH = route(
  { auth: "multi", as: ["shopper", "brand", "admin"], query: prefsQuery, body: preferencesPatchBody, maxBody: 2048, rate: { key: "prefs.write", limit: 30, windowSec: 60 } },
  async ({ actor, body }) => ({ preferences: await withTx(() => updatePreferences(actor.userId, body)) }),
)
