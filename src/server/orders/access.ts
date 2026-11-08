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
