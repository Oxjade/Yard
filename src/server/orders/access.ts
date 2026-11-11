import "server-only"
import type { AdminActor, BrandActor } from "../auth/dal"
import { requireRecentReauth } from "../auth"
import { forbidden, notFound } from "../http/errors"
import { isOrderRefId } from "./core"

/** Path ids: letters, digits, _ and - only, else 404 before any query is built. */
export function pathId(v: string | undefined): string {
  if (!isOrderRefId(v)) throw notFound()
  return v
}

/**
 * Brand refunds move money, so only the brand's owner and admins may issue them (fulfilment staff
 * can decide and receive returns, whose refund follows the computed amount). Interim until
 * src/lib/permissions.ts gains an "orders.refund" permission.
 */
export function assertBrandMayRefund(actor: BrandActor) {
  if (actor.role !== "owner" && actor.role !== "admin") throw forbidden("Only the brand's owner or admins can issue refunds.")
}

/** Admin money actions need a recent re-authentication (AUTH: TOTP within the last 5 minutes). */
export async function assertAdminRecentReauth(actor: AdminActor) {
  await requireRecentReauth(actor, 300)
}

/**
 * Brand actions that send money back to a customer (a refund, cancelling a paid order, receiving a
 * return with its refund) need the password re-confirmed within the last 5 minutes. The route
 * checks this before the transaction (it throws 403 fields.reauth = "required"); the Studio asks
 * for the password, POSTs /api/auth/reauth?as=brand and retries with the same Idempotency-Key.
 */
export async function assertBrandMoneyReauth(actor: BrandActor) {
  await requireRecentReauth(actor, 300)
}

/** The payment states where money was taken, so cancelling or receiving a return refunds it. */
export const isCapturedPayment = (payment: string) => payment === "paid" || payment === "partially_refunded"
