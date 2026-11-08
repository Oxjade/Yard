import { withTx } from "@/server/db"
import { readUnsubscribeToken, suppress } from "@/server/email"
import { unsubscribeQuery } from "@/server/follows/contracts"
import { badRequest } from "@/server/http/errors"
import { route } from "@/server/http/route"

const labels: Record<string, string> = { all: "all optional emails", drops: "drop emails", price_drops: "price-drop emails", back_in_stock: "back-in-stock emails", brand_news: "brand news" }

function read(token: string) {
  const t = readUnsubscribeToken(token)
  if (!t) throw badRequest({ token: "This unsubscribe link isn't valid." }, "This unsubscribe link isn't valid.")
  return t
}

/** GET /api/notifications/preferences/unsubscribe?token=: what the link would unsubscribe (read-only, so link scanners change nothing). */
export const GET = route({ auth: "public", query: unsubscribeQuery, rate: { key: "unsubscribe.read", limit: 30, windowSec: 60, anonGlobal: 1000 } }, async ({ query }) => {
  const t = read(query.token)
  return { category: t.category, label: labels[t.category] }
})

/**
 * POST /api/notifications/preferences/unsubscribe?token=: unsubscribes the address in the token
 * (RFC 8058 one-click from mail clients, and the /unsubscribe page). The signed token is the only
 * credential, so no session or CSRF header is needed.
 */
export const POST = route({ auth: "public", csrf: false, query: unsubscribeQuery, rate: { key: "unsubscribe", limit: 30, windowSec: 60, anonGlobal: 1000 } }, async ({ query }) => {
  const t = read(query.token)
  await withTx((tx) => suppress(t.email, t.category, "unsubscribe", tx))
  return { unsubscribed: true, category: t.category, label: labels[t.category] }
})
