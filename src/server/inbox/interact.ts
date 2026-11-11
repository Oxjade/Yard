import "server-only"
import { and, eq, or } from "drizzle-orm"
import type { Interaction } from "@/lib/api/contracts/inbox"
import { activeRestriction, brandListed, type BrandActor, type ShopperActor } from "../auth/dal"
import { db } from "../db"
import { blocks, brands, users } from "../db/schema"
import { blocked, restricted, type HttpError } from "../http/errors"
import type { ConvRow } from "./dto"
import { openSpamAlert } from "./spam"

/**
 * The one interaction check (§4.4). Send, typing, reactions, read receipts and inbox uploads all
 * go through it: blocks in both directions, `locked`, the actor's messaging restriction, the
 * brand's status, and an open spam_marks alert (which holds instead of refusing). What a refusal
 * does is the caller's business: typing → silent 204; send/reaction/upload → 403; read → only the
 * reader's own counters change.
 */

export type Refusal = { ok: false; error: HttpError; reason: NonNullable<Interaction["reason"]>; until: Date | null; scope?: "account" | "brand" }
export type Allowed = { ok: true; hold: "spam_marked_by_brand" | null }
export type InteractResult = Allowed | Refusal

const dateText = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
/** A sentence that ends with a name: no second full stop when the name already ends in . ! or ? ("Kumasi Thread Co."). */
const endWith = (sentence: string) => (/[.!?]$/.test(sentence) ? sentence : `${sentence}.`)

export async function blockState(customerId: string, brandId: string) {
  const d = await db()
  const rows = await d
    .select({ kind: blocks.blockerKind })
    .from(blocks)
    .where(
      or(
        and(eq(blocks.blockerKind, "shopper"), eq(blocks.blockerId, customerId), eq(blocks.blockedKind, "brand"), eq(blocks.blockedId, brandId)),
        and(eq(blocks.blockerKind, "brand"), eq(blocks.blockerId, brandId), eq(blocks.blockedKind, "shopper"), eq(blocks.blockedId, customerId)),
      ),
    )
  return { shopperBlockedBrand: rows.some((r) => r.kind === "shopper"), brandBlockedShopper: rows.some((r) => r.kind === "brand") }
}

const refuse = (error: HttpError, reason: Refusal["reason"], until: Date | null = null, scope?: Refusal["scope"]): Refusal => ({ ok: false, error, reason, until, ...(scope ? { scope } : {}) })

/** For a shopper writing to `brandId` (an existing conversation or a new thread). */
export async function shopperCanInteract(actor: ShopperActor, target: { brandId: string; locked?: boolean }): Promise<InteractResult> {
  const d = await db()
  const [brand] = await d
    .select({ name: brands.name, reviewStatus: brands.reviewStatus, founding: brands.founding, launchedAt: brands.launchedAt, claimStatus: brands.claimStatus })
    .from(brands)
    .where(eq(brands.id, target.brandId))
    .limit(1)
  const name = brand?.name ?? "This brand"
  if (target.locked) return refuse(restricted("This conversation was closed by Yard."), "locked")
  if (!brand || !brandListed(brand)) return refuse(restricted(`${name} isn't taking messages right now.`), "brand_unavailable")
  // A founding brand nobody has claimed yet has no one to read its inbox (Yard setup can't open it).
  if (brand.claimStatus === "unclaimed") return refuse(restricted(`${name} isn't taking messages yet. Follow it to hear when it opens.`), "brand_unavailable")
  const b = await blockState(actor.userId, target.brandId)
  if (b.brandBlockedShopper) return refuse(blocked(endWith(`You can't message ${name}`)), "blocked_by_them")
  if (b.shopperBlockedBrand) return refuse(blocked(`${endWith(`You blocked ${name}`)} Unblock them to send a message.`), "blocked_by_me")
  const r = await activeRestriction("user", actor.userId, "messaging")
  if (r) return refuse(restricted(r.until ? `Messaging is paused on your account until ${dateText(r.until)}.` : "Messaging is paused on your account."), "restricted", r.until)
  const alert = await openSpamAlert(actor.userId)
  return { ok: true, hold: alert && !alert.brands.includes(target.brandId) ? "spam_marked_by_brand" : null }
}

/** For a brand member replying in a conversation of the active brand. */
export async function brandCanInteract(actor: BrandActor, conv: ConvRow): Promise<InteractResult> {
  const d = await db()
  const [customer] = await d.select({ name: users.name }).from(users).where(eq(users.id, conv.customerId)).limit(1)
  const name = customer?.name ?? "This shopper"
  if (conv.locked) return refuse(restricted("This conversation was closed by Yard."), "locked")
  if (actor.brand.reviewStatus === "restricted") return refuse(restricted(`Yard has restricted ${actor.brand.name}, so publishing and replies are paused.`), "restricted")
  const b = await blockState(conv.customerId, conv.brandId)
  if (b.shopperBlockedBrand) return refuse(blocked(`${name} isn't accepting messages from you.`), "blocked_by_them")
  if (b.brandBlockedShopper) return refuse(blocked(`${endWith(`You blocked ${name}`)} Unblock them to reply.`), "blocked_by_me")
  const r = await activeRestriction("brand", conv.brandId, "messaging")
  if (r) return refuse(restricted(r.until ? `Yard paused replies from ${actor.brand.name} until ${dateText(r.until)}.` : endWith(`Yard paused replies from ${actor.brand.name}`)), "restricted", r.until)
  // A messaging restriction on the member's own account stops them replying for any brand (uploads check the same, §2.4).
  const own = await activeRestriction("user", actor.userId, "messaging")
  if (own) return refuse(restricted(own.until ? `Messaging is paused on your account until ${dateText(own.until)}.` : "Messaging is paused on your account."), "restricted", own.until, "account")
  return { ok: true, hold: null }
}

/** The composer state a thread shows (never the hold: a shadow hold isn't announced). */
export function toInteraction(r: InteractResult, opts: { canReply?: boolean } = {}): Interaction {
  if (!r.ok) return { canSend: false, reason: r.reason, until: r.until ? r.until.toISOString() : null, ...(r.scope ? { scope: r.scope } : {}) }
  if (opts.canReply === false) return { canSend: false, reason: "role" }
  return { canSend: true }
}
