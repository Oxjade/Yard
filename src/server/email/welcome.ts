import "server-only"
import { encodeWelcomeBrands, WELCOME_MAX_BRANDS, WELCOME_TEMPLATE, type WelcomeBrand } from "@/lib/welcome-email"
import { brandListedSql } from "../catalog/sellable"
import { db, type Executor } from "../db"
import { log } from "../log"
import { enqueueEmail } from "./index"
import { renderEmail } from "./templates"
import { pickWelcomeBrands, queueWelcome, type Db, type WelcomeOutcome } from "./welcome-db"

/**
 * The shopper welcome email (`shopper_welcome`), once per account (src/lib/welcome-email.ts says
 * who gets it). AUTH calls queueShopperWelcome inside the transaction that made the account
 * usable; the outbox sends it after commit. Brands to follow are picked when it is sent.
 */

/** Queues the welcome for `userId` in the ambient transaction, if the account should get one. */
export async function queueShopperWelcome(userId: string): Promise<WelcomeOutcome> {
  const d = await db()
  const out = await queueWelcome(d as unknown as Db, userId, (input) => enqueueEmail(d, input))
  if (out.queued) log.info(`[yard] welcome email queued for ${userId}`)
  return out
}

/** Live, public brands to follow (the /brands rule), up to `limit`. */
export async function welcomeBrands(ex?: Executor, limit = WELCOME_MAX_BRANDS): Promise<WelcomeBrand[]> {
  return pickWelcomeBrands((ex ?? (await db())) as unknown as Db, brandListedSql(), limit)
}

/** The delivery worker's send-time fill: the `brands` var from the live catalogue. */
export async function welcomeSendVars(ex: Executor, vars: Record<string, string | number>): Promise<Record<string, string | number>> {
  if (vars.brands !== undefined) return vars
  return { ...vars, brands: encodeWelcomeBrands(await welcomeBrands(ex)) }
}

/**
 * Admin preview (GET /api/admin/emails/welcome/preview): the real email. `brands`: "live" picks
 * them the way a send does; a number shows that many of the live brands (0 shows the email
 * without the list).
 */
export async function previewShopperWelcome(opts: { brands: "live" | number; name?: string }) {
  const list = await welcomeBrands(undefined, opts.brands === "live" ? WELCOME_MAX_BRANDS : opts.brands)
  const r = renderEmail(WELCOME_TEMPLATE, { name: opts.name ?? "Ada", brands: encodeWelcomeBrands(list) }, { unsubscribeUrl: null })
  return { subject: r.subject, html: r.html, text: r.text, brands: list }
}
