import "server-only"
import type { AdminActor, BrandActor } from "../auth/dal"
import { reauthMethodsFor, requireRecentReauth } from "../auth"
import { isRealSession } from "../auth/session-auth"
import { getEnv } from "../env"
import { HttpError, forbidden, notFound } from "../http/errors"
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
 * checks this before the transaction (it throws 403 fields.reauth = "required", with
 * fields.reauthWith saying how this account confirms); the Studio asks for the password (or opens
 * the Google/Apple confirm for an account without one) and retries with the same Idempotency-Key.
 */
export async function assertBrandMoneyReauth(actor: BrandActor) {
  // A demo deployment (YARD_SEED_DEMO=1 outside development): demo sessions can never re-confirm
  // there (reauthenticate refuses the demo confirm outside development), so asking would block
  // every demo refund, paid cancel and return receive. Demo brands move no real money, and these
  // actions needed no re-auth before, so a demo brand session goes straight through. In
  // development the demo confirm works and the ask stays, so the flow can be exercised. Real
  // brand sessions always re-confirm.
  const env = getEnv()
  if (actor.demo && env.seedDemo && !env.dev && !(await isRealSession(actor.sessionId))) return
  try {
    await requireRecentReauth(actor, 300)
  } catch (e) {
    // Say how this account can confirm ("password", "demo", or its Google/Apple providers), so
    // Studio shows a password field or a "Confirm with Google" button, never a dead end.
    if (e instanceof HttpError && e.fields?.reauth === "required") throw new HttpError(e.status, e.code, e.message, { ...e.fields, reauthWith: await reauthMethodsFor(actor) })
    throw e
  }
}

/** The payment states where money was taken, so cancelling or receiving a return refunds it. */
export const isCapturedPayment = (payment: string) => payment === "paid" || payment === "partially_refunded"
