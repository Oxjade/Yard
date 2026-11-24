/**
 * Brand emails from Yard: the copy of every email Yard sends a brand about its shop (reminders,
 * decisions and the admin's one-tap messages), the admin presets, and the reminder rules. Pure (no
 * "server-only", no database), so the Admin composer, the email templates (src/server/email/templates.ts)
 * and `tsx --test` all read the same words and rules.
 *
 * Tone: warm, playful, short. At most one emoji per email (in the heading). Never sarcastic,
 * never fake urgency. Decision emails stay kind and say exactly what to do next.
 */

/* ---------- Reminder rules (catalog/nudges.ts runs them every 30 minutes) ---------- */

const HOUR = 3600_000
/** A draft gets its reminder once it's been a draft this long. */
export const DRAFT_NUDGE_AFTER_MS = 12 * HOUR
/** Drafts older than this are left alone (a shelved idea, not a forgotten listing). */
export const DRAFT_NUDGE_MAX_AGE_MS = 30 * 24 * HOUR
/** At most one reminder per brand in this window, whatever triggered it. */
export const NUDGE_COOLDOWN_MS = 24 * HOUR
/** A claimed founding brand with products but no published storefront hears about it this long after claiming. */
export const STOREFRONT_NUDGE_AFTER_MS = 24 * HOUR
/** Products named in one reminder (the rest are counted). */
export const DRAFT_NUDGE_NAMED = 3

export type DraftCandidate = {
  productId: string
  brandId: string
  title: string
  status: string
  createdAt: Date
  publishedAt: Date | null
  draftNudgedAt: Date | null
  moderation: string
  brandReview: string
  brandNudges: boolean
  claimStatus: string
  /** When a founding brand was claimed (null for ordinary brands): its owners could publish from then on. */
  claimedAt: Date | null
  /** When the brand's application was approved (null if it never applied): it could publish from then on. */
  approvedAt: Date | null
  /** An onboarding application in draft, submitted or rejected: the brand can't publish yet. */
  underReview: boolean
  brandLastNudgedAt: Date | null
  /** Founding brand whose storefront was never published. */
  storefrontUnpublished: boolean
}

/**
 * When the 12-hour clock starts for a draft: the latest of its creation, the brand's claim (a founding
 * brand's drafts prepared by Yard before it was claimed) and its application's approval (the first
 * product saved with the application, which can't be published until approval).
 */
export function draftClockStart(c: Pick<DraftCandidate, "createdAt" | "claimedAt" | "approvedAt">): Date {
  return new Date(Math.max(c.createdAt.getTime(), c.claimedAt?.getTime() ?? 0, c.approvedAt?.getTime() ?? 0))
}

/** Whether this product's "still in drafts" reminder is due now (the SQL in catalog/nudges.ts applies the same rules). */
export function draftNudgeEligible(c: DraftCandidate, now: Date): boolean {
  const age = now.getTime() - draftClockStart(c).getTime()
  if (c.status !== "draft" || c.publishedAt || c.draftNudgedAt) return false
  if (age < DRAFT_NUDGE_AFTER_MS || age > DRAFT_NUDGE_MAX_AGE_MS) return false
  if (c.moderation !== "ok") return false
  if (c.brandReview === "restricted" || c.brandReview === "suspended") return false
  if (!c.brandNudges || c.underReview || c.claimStatus === "unclaimed") return false
  if (c.brandLastNudgedAt && now.getTime() - c.brandLastNudgedAt.getTime() < NUDGE_COOLDOWN_MS) return false
  return true
}

export type DraftNudge = { brandId: string; products: { id: string; title: string }[]; storefrontUnpublished: boolean }

/** One reminder per brand per run, oldest draft first, covering every due draft of that brand (each is marked so it's never sent again). */
export function groupDraftNudges(candidates: DraftCandidate[], now: Date): DraftNudge[] {
  const out = new Map<string, DraftNudge>()
  for (const c of [...candidates].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.productId.localeCompare(b.productId))) {
    if (!draftNudgeEligible(c, now)) continue
    const g = out.get(c.brandId) ?? { brandId: c.brandId, products: [], storefrontUnpublished: c.storefrontUnpublished }
    if (!g.products.some((p) => p.id === c.productId)) g.products.push({ id: c.productId, title: c.title })
    out.set(c.brandId, g)
  }
  return [...out.values()]
}

export type StorefrontCandidate = {
  brandId: string
  founding: boolean
  claimStatus: string
  claimedAt: Date | null
  launchedAt: Date | null
  storefrontNudgedAt: Date | null
  brandReview: string
  brandNudges: boolean
  brandLastNudgedAt: Date | null
  /** Published or scheduled products: what shoppers would see the moment the storefront goes live. */
  readyProducts: number
}

/** A claimed founding brand with ready products whose storefront was never published, a day after claiming: once per brand. */
export function storefrontNudgeEligible(c: StorefrontCandidate, now: Date): boolean {
  if (!c.founding || c.claimStatus !== "claimed" || c.launchedAt || c.storefrontNudgedAt) return false
  if (!c.claimedAt || now.getTime() - c.claimedAt.getTime() < STOREFRONT_NUDGE_AFTER_MS) return false
  if (c.readyProducts < 1 || !c.brandNudges) return false
  if (c.brandReview === "restricted" || c.brandReview === "suspended") return false
  if (c.brandLastNudgedAt && now.getTime() - c.brandLastNudgedAt.getTime() < NUDGE_COOLDOWN_MS) return false
  return true
}

/* ---------- Copy ---------- */

/** What one brand email says (templates.ts adds the layout, link checks and escaping). */
export type BrandEmailCopy = {
  subject: string
  preheader: string
  eyebrow?: string
  heading: string
  greeting?: string
  paragraphs: string[]
  action?: { label: string; url: string }
  facts?: { label: string; value: string }[]
  note?: string
  why: string
  footerLink?: { lead: string; label: string; url: string }
  /** Paragraphs with links, after `paragraphs` (e.g. the shop's address). Plain text runs; templates.ts checks every link. */
  linkParagraphs?: { text: string; href?: string; bold?: boolean }[][]
}

/** Where a brand switches reminders off (Studio › Settings › Emails from Yard). */
export const NUDGE_SETTINGS_PATH = "/studio/settings#emails"
const optOut = { lead: "Not into reminders?", label: "Switch them off in Studio settings", url: NUDGE_SETTINGS_PATH }
const SUPPORT_LINE = "Questions? Message @support from Yard Support in Studio and a real person on the team gets back to you."
const quote = (s: string) => `“${s.trim().replace(/^["“]|["”]$/g, "")}”`
const and = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : (names[0] ?? ""))

export function draftNudgeCopy(x: { brand: string; product: string; productId?: string; more?: number; others?: string[]; storefrontUnpublished?: boolean }): BrandEmailCopy {
  const more = Math.max(0, Math.floor(x.more ?? 0))
  const others = (x.others ?? []).filter(Boolean)
  return {
    subject: more ? `Your ${x.product} (and ${more} more) are chilling in drafts` : `Your ${x.product} is chilling in drafts`,
    preheader: "One tap and it's live. Shoppers can't cop what they can't see.",
    eyebrow: "Yard Studio",
    heading: "Still in drafts 👀",
    greeting: x.brand ? `Hey ${x.brand},` : undefined,
    paragraphs: [
      more ? `${x.product} and ${more === 1 ? "another piece are" : `${more} other pieces are`} saved in Studio, but they're still drafts, so nobody on Yard can see them yet.` : `${x.product} is saved in Studio, but it's still a draft, so nobody on Yard can see it yet.`,
      "If it's ready, give it one last look (photos, options, price) and hit Publish. That's the whole move.",
      ...(x.storefrontUnpublished ? ["One more thing: your storefront isn't published yet either. Publish it from Storefront in Studio so the whole Yard can find you."] : []),
      "Still cooking? No stress, it'll wait for you.",
    ],
    facts: [{ label: "In drafts", value: x.product }, ...(others.length ? [{ label: "Also in drafts", value: more > others.length ? `${others.join(", ")} and ${more - others.length} more` : and(others) }] : [])],
    action: { label: more ? "Finish and publish" : `Publish ${x.product.length > 24 ? "it" : x.product}`, url: x.productId ? `/studio/products/${encodeURIComponent(x.productId)}` : "/studio/products" },
    why: `You're getting this because ${x.brand || "your brand"} has a product in drafts on Yard.`,
    footerLink: optOut,
  }
}

export function storefrontNudgeCopy(x: { brand: string; products?: number }): BrandEmailCopy {
  const n = Math.max(0, Math.floor(x.products ?? 0))
  return {
    subject: `${x.brand}, your storefront is ready for its moment`,
    preheader: "Your pieces are set. Publish the storefront and the doors open.",
    eyebrow: "Yard Studio",
    heading: "Open the doors ✨",
    greeting: `Hey ${x.brand},`,
    paragraphs: [
      `${n > 1 ? `${n} pieces are` : n === 1 ? "Your first piece is" : "Your pieces are"} ready in Studio, but your storefront hasn't been published yet, so shoppers can't find ${x.brand} on Yard.`,
      "Open Storefront in Studio, check your banner and story, and hit Publish. Everything shows up the moment it's live.",
      "Want a second pair of eyes first? Message @support in Studio and we'll take a look.",
    ],
    action: { label: "Publish my storefront", url: "/studio/storefront" },
    why: `You're getting this because you run ${x.brand} on Yard and its storefront isn't published yet.`,
    footerLink: optOut,
  }
}

/**
 * "New from your website": a website watch (docs/IMPORTER.md › Watching a website) found pieces on
 * the brand's own site that aren't on Yard yet. Once per check with new pieces; a reminder, so it
 * respects the brand's "Emails from Yard" switch.
 */
export function websitePiecesCopy(x: { brand: string; count: number }): BrandEmailCopy {
  const n = Math.max(1, Math.floor(x.count || 1))
  return {
    subject: n === 1 ? "1 new piece from your website is waiting" : `${n} new pieces from your website are waiting`,
    preheader: `Add ${n === 1 ? "it" : "them"} to Yard in one tap.`,
    eyebrow: "Yard Studio",
    heading: "Fresh from your site ✨",
    greeting: x.brand ? `Hey ${x.brand},` : undefined,
    paragraphs: [
      `${n} new ${n === 1 ? "piece" : "pieces"} from your website ${n === 1 ? "is" : "are"} waiting. Add ${n === 1 ? "it" : "them"} to Yard in one tap.`,
      n === 1
        ? "We copied the photos, name, price and options from your site. Tap Add to Yard and it goes live in your shop, or Not this one and we won't ask again."
        : "We copied the photos, names, prices and options from your site. Tap Add all and they all go live in your shop at once, or pick them one by one.",
    ],
    action: { label: n === 1 ? "Add it to Yard" : `Add all ${n} to Yard`, url: "/studio/products#from-website" },
    why: `You're getting this because Yard watches ${x.brand || "your brand"}'s website for new pieces.`,
    footerLink: optOut,
  }
}

/**
 * "Your shop is live": Yard published the brand's storefront for it (Admin › Publish storefront for
 * {brand}), or it went live the moment the owner claimed it ("Go live when they claim").
 * `shop` is how the link reads ("yardstore.space/brands/handle"); `payout` false adds the payout nudge.
 */
export function shopLiveCopy(x: { brand: string; handle: string; shop: string; variant: "yard" | "claim"; payout: boolean }): BrandEmailCopy {
  const claim = x.variant === "claim"
  return {
    subject: claim ? `You claimed ${x.brand} and you're live 🎉` : `${x.brand}, your shop is live on Yard 🎉`,
    preheader: claim ? "Your shop went live the moment you claimed it. Shoppers can find you now." : "We put your shop live for you. Shoppers can find you now.",
    eyebrow: "Yard Studio",
    heading: "You're live 🎉",
    greeting: `Hey ${x.brand},`,
    paragraphs: [claim ? "Your shop went live the moment you claimed it, so shoppers can find you now." : "We put your shop live for you, so shoppers can find you now."],
    linkParagraphs: [
      [{ text: "Your shop: " }, { text: x.shop, href: `/brands/${x.handle}`, bold: true }],
      [{ text: "Change anything in " }, { text: "Studio", href: "/studio" }, { text: " anytime." }],
      ...(x.payout ? [] : [[{ text: "One thing left: add your payout account so shoppers can buy. Takes about 2 minutes. " }, { text: "Add my payout account", href: "/studio/settings#payouts" }]]),
    ],
    action: { label: "See my shop", url: `/brands/${x.handle}` },
    why: `You're getting this because you run ${x.brand} on Yard.`,
  }
}

/**
 * "Add your payout account" (`brand_payout_needed`, ledger/payout-needed-db.ts). A brand sells
 * without a payout account and Yard holds its earnings in the ledger. `variant` "sale": an order of
 * theirs was just paid (`reference`), at most one a day. "reminder": once, 3 days after the first such
 * sale. `owed`: what Yard holds for them, formatted ("₦45,000"); `sales`: paid sales waiting.
 */
export function payoutNeededCopy(x: { brand: string; owed: string; sales: number; reference?: string; variant: "sale" | "reminder" }): BrandEmailCopy {
  const n = Math.max(1, Math.floor(x.sales || 1))
  const salesText = n === 1 ? "1 sale" : `${n} sales`
  const reference = x.reference?.trim()
  const add = "Add your bank account in Studio and we'll get it to you. It takes about 2 minutes, and only the last four digits ever show."
  const why = `You're getting this because you run payouts for ${x.brand} on Yard. It comes at most once a day and stops as soon as your payout account is in.`
  const facts = [...(reference && x.variant === "sale" ? [{ label: "Order", value: reference }] : []), { label: "Earned so far", value: x.owed }, { label: "Sales waiting", value: String(n) }]
  const action = { label: "Add payout account", url: "/studio/settings#payouts" }
  if (x.variant === "reminder") {
    return {
      subject: `${x.owed} is waiting for you on Yard. Add your payout account so we can pay you`,
      preheader: "We're holding your earnings safely. Tell us where to send them.",
      eyebrow: "Yard Studio · Payouts",
      heading: "Your earnings are waiting 💸",
      greeting: `Hey ${x.brand},`,
      paragraphs: [
        `You've made ${salesText} on Yard and earned ${x.owed} so far. There's still no payout account on file, so we can't send it to you yet.`,
        "Your money is safe: Yard holds it for you until you add a bank account. Nothing is lost while you wait.",
        add,
      ],
      facts,
      action,
      why,
    }
  }
  return {
    subject: "You made a sale 🎉 Add your payout account so we can pay you",
    preheader: `${x.owed} earned so far. Add a bank account and we'll send it your way.`,
    eyebrow: "Yard Studio · Payouts",
    heading: "You made a sale 🎉",
    greeting: `Hey ${x.brand},`,
    paragraphs: [
      `${reference ? `Order ${reference} just got paid` : "One of your orders just got paid"}${n > 1 ? `, and that makes ${salesText} waiting for you` : ""}. Nice one.`,
      `You've earned ${x.owed} so far. Yard holds your earnings safely until you add a bank account, so we've got nowhere to send them yet.`,
      add,
    ],
    facts,
    action,
    why,
  }
}

export function applicationRejectedCopy(x: { brand: string; name?: string; reason?: string }): BrandEmailCopy {
  const first = x.name?.trim().split(/\s+/)[0]
  return {
    subject: `A few tweaks and ${x.brand} is good to go`,
    preheader: "We went through your application. Here's what to change before you resubmit.",
    eyebrow: "Your application",
    heading: "Almost there",
    greeting: first ? `Hey ${first},` : `Hey ${x.brand},`,
    paragraphs: [
      `Thanks for applying to sell ${x.brand} on Yard. We went through everything and we can't approve it just yet.`,
      ...(x.reason?.trim() ? [`Here's what the team said: ${quote(x.reason)}`] : []),
      "Make those changes in Studio and resubmit whenever you're ready. Everything you entered is saved, so it's a quick fix, not a fresh start.",
      SUPPORT_LINE,
    ],
    action: { label: "Update my application", url: "/studio/onboarding" },
    why: "You're getting this because you applied to sell on Yard with this address.",
  }
}

/**
 * Where a listing stands with shoppers, moderation aside: "live" when shoppers can see it, otherwise
 * what keeps it off Yard (the brand is restricted or suspended, the product isn't published, or a
 * founding brand's storefront isn't published). The same rules as productPublicWhere.
 */
export type ListingState = "live" | "brand" | "unpublished" | "storefront"
export const LISTING_STATES: readonly ListingState[] = ["live", "brand", "unpublished", "storefront"]

export function listingState(x: { status: string; publishAt?: Date | null; brandReview: string; founding: boolean; launchedAt: Date | null }, now = new Date()): ListingState {
  if (x.brandReview === "restricted" || x.brandReview === "suspended") return "brand"
  const published = x.status === "published" || (x.status === "scheduled" && !!x.publishAt && x.publishAt.getTime() <= now.getTime())
  if (!published) return "unpublished"
  if (x.founding && !x.launchedAt) return "storefront"
  return "live"
}

type ListingNames = { brand: string; product: string; productId?: string; more?: number; others?: string[] }

/** "Thorn Tee", or "Thorn Tee and 3 more" when one email covers several listings. */
function listingNames(x: ListingNames) {
  const more = Math.max(0, Math.floor(x.more ?? 0))
  const others = (x.others ?? []).filter(Boolean)
  return {
    more,
    label: more ? `${x.product} and ${more} more` : x.product,
    is: more ? "are" : "is",
    it: more ? "them" : "it",
    facts: [{ label: more ? "Products" : "Product", value: more > others.length ? `${[x.product, ...others].join(", ")} and ${more - others.length} more` : and([x.product, ...others]) }],
    action: (label: string) => ({ label, url: !more && x.productId ? `/studio/products/${encodeURIComponent(x.productId)}` : "/studio/products" }),
  }
}

/** A listing (or several of one brand's, in one email) put on hold by moderation. `wasLive`: shoppers could see it until now. */
export function listingHeldCopy(x: ListingNames & { reason?: string; wasLive?: boolean }): BrandEmailCopy {
  const n = listingNames(x)
  const live = x.wasLive !== false
  return {
    subject: live ? `${n.label} ${n.is} taking a quick break from Yard` : `${n.label} ${n.is} on hold for now`,
    preheader: live ? `We've paused ${n.more ? "these listings" : "this listing"}. Here's why and how to bring ${n.it} back.` : `We've put a hold on ${n.more ? "these listings" : "this listing"}. Here's why and what to change.`,
    eyebrow: n.more ? "Your listings" : "Your listing",
    heading: live ? (n.more ? "Listings on pause" : "Listing on pause") : "On hold for now",
    greeting: `Hey ${x.brand},`,
    paragraphs: [
      live
        ? `We've paused ${n.label}, so ${n.more ? "they aren't" : "it isn't"} showing on Yard for now. ${n.more ? "They're" : "It's"} safe in Studio and nothing else in your shop has changed.`
        : `We've put a hold on ${n.label}, so ${n.more ? "they" : "it"} can't go live for now. ${n.more ? "They're" : "It's"} safe in Studio and nothing else in your shop has changed.`,
      ...(x.reason?.trim() ? [`Why: ${quote(x.reason)}`] : []),
      `Sort it out in Studio, then message @support when ${n.more ? "they're" : "it's"} ready. We'll take another look and lift the hold.`,
    ],
    facts: n.facts,
    action: n.action("Fix it in Studio"),
    why: `You're getting this because you run ${x.brand} on Yard.`,
  }
}

/** The hold on a listing (or several) is lifted. Only a `live` one is "back on Yard"; otherwise it says what's left before it shows. */
export function listingBackCopy(x: ListingNames & { state?: ListingState }): BrandEmailCopy {
  const n = listingNames(x)
  const state = x.state ?? "live"
  if (state === "live") {
    return {
      subject: `${n.label} ${n.is} back on Yard 🎉`,
      preheader: `${n.more ? "They're" : "It's"} live again. Shoppers can find ${n.it}, save ${n.it} and buy ${n.it}.`,
      eyebrow: n.more ? "Your listings" : "Your listing",
      heading: "Back in rotation",
      greeting: `Hey ${x.brand},`,
      paragraphs: [`Good news: ${n.label} ${n.is} back on Yard. Shoppers can find ${n.it}, save ${n.it} and buy ${n.it} again.`, "Thanks for sorting it out. Keep the heat coming."],
      facts: n.facts,
      action: n.action("View in Studio"),
      why: `You're getting this because you run ${x.brand} on Yard.`,
    }
  }
  const next =
    state === "unpublished"
      ? `${n.more ? "They aren't" : "It isn't"} published yet, so publish ${n.it} in Studio whenever ${n.more ? "they're" : "it's"} ready and ${n.more ? "they show" : "it shows"} up on Yard.`
      : state === "storefront"
        ? `${n.more ? "They show" : "It shows"} up on Yard as soon as your storefront is published.`
        : `${n.more ? "They show" : "It shows"} up on Yard once your shop is fully back. Message @support if you're not sure what's left.`
  return {
    subject: `The hold on ${n.label} is lifted`,
    preheader: "All clear from our side. Here's what's left before shoppers see it.",
    eyebrow: n.more ? "Your listings" : "Your listing",
    heading: "All clear",
    greeting: `Hey ${x.brand},`,
    paragraphs: [`Good news: we've lifted the hold on ${n.label}.`, next, "Thanks for sorting it out."],
    facts: n.facts,
    action: state === "storefront" ? { label: "Open my storefront", url: "/studio/storefront" } : n.action("Open in Studio"),
    why: `You're getting this because you run ${x.brand} on Yard.`,
  }
}

/* ---------- Admin one-tap emails ---------- */

export const BRAND_EMAIL_PRESETS = ["finish_listing", "publish_storefront", "payout_account", "photos", "custom"] as const
export type BrandEmailPreset = (typeof BRAND_EMAIL_PRESETS)[number]

export const isBrandEmailPreset = (v: string): v is BrandEmailPreset => (BRAND_EMAIL_PRESETS as readonly string[]).includes(v)

type PresetDef = {
  label: string
  /** One line in the composer: when to use it. */
  hint: string
  heading: string
  subject: (brand: string) => string
  body: (brand: string) => string
  action: { label: string; url: string }
}

export const brandEmailPresets: Record<BrandEmailPreset, PresetDef> = {
  finish_listing: {
    label: "Finish your listing",
    hint: "Products sitting in drafts",
    heading: "So close 👀",
    subject: (b) => `${b}, your drafts are so close`,
    body: () =>
      "Your products are saved in Studio but still sitting in drafts, which means shoppers can't see them yet.\n\nGive them one last look (photos, options, price) and hit Publish. That's it, you're live.\n\nNeed a hand with anything? We're right here.",
    action: { label: "Open my products", url: "/studio/products" },
  },
  publish_storefront: {
    label: "Publish your storefront",
    hint: "Storefront set up but never published",
    heading: "Open the doors ✨",
    subject: (b) => `${b}, let's open the doors`,
    body: () => "Your storefront is set up but not published yet, so Yard shoppers can't find you.\n\nHead to Storefront in Studio, check your banner and story, and hit Publish. Your pieces show up the moment it's live.",
    action: { label: "Open my storefront", url: "/studio/storefront" },
  },
  payout_account: {
    label: "Add a payout account",
    hint: "No payout account on file",
    heading: "Where should the money go? 💸",
    subject: (b) => `Let's get ${b} paid`,
    body: () =>
      "You're nearly ready to sell, but there's no payout account on file yet, so we've got nowhere to send your earnings.\n\nIt takes about two minutes: Studio, then Settings, then Payouts. Only the last four digits ever show in Studio.",
    action: { label: "Add my payout account", url: "/studio/settings#payouts" },
  },
  photos: {
    label: "Photos need love",
    hint: "Photos that don't do the pieces justice",
    heading: "Give your photos some love 📸",
    subject: () => "Your pieces deserve better photos",
    body: () =>
      "Your pieces look great, but a few of the photos aren't doing them justice yet.\n\nQuick wins: natural light, a clean background, the whole piece in frame and a close-up of the details. Shoppers buy what they can see.\n\nSwap them in Studio whenever you're ready.",
    action: { label: "Update my photos", url: "/studio/products" },
  },
  custom: {
    label: "Custom message",
    hint: "Write your own",
    heading: "Hey from Yard 👋",
    subject: () => "A quick note from Yard",
    body: () => "",
    action: { label: "Open Studio", url: "/studio" },
  },
}

export const BRAND_EMAIL_SUBJECT_MAX = 120
export const BRAND_EMAIL_BODY_MAX = 3000
/** Manual emails to one brand in 24 hours (any admin). */
export const BRAND_EMAIL_DAILY_PER_BRAND = 5

/** Paragraphs of an admin-written body: blank lines split them; single newlines become spaces. */
export function bodyParagraphs(body: string): string[] {
  return body
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean)
    .slice(0, 12)
}

export function brandMessageCopy(x: { brand: string; preset: BrandEmailPreset; subject: string; body: string; signoff?: string }): BrandEmailCopy {
  const p = brandEmailPresets[x.preset]
  const paragraphs = bodyParagraphs(x.body)
  return {
    subject: x.subject.trim(),
    preheader: (paragraphs[0] ?? x.subject).slice(0, 140),
    eyebrow: "A note from Yard",
    heading: p.heading,
    greeting: `Hey ${x.brand},`,
    paragraphs,
    action: p.action,
    note: `${x.signoff?.trim() ? `${x.signoff.trim().split(/\s+/)[0]} from the Yard team. ` : "The Yard team. "}Want to reply? Message @support from Yard Support in Studio and it comes straight to us.`,
    why: `You're getting this because you run ${x.brand} on Yard.`,
  }
}

/* ---------- Sent history (Admin › Brands) ---------- */

/** Audit actions that put an email in a brand's inbox, with how the history names them. */
export const brandEmailHistoryLabels: Record<string, string> = {
  "brand_email.sent": "Email from Yard",
  "brand_email.draft_nudge": "Reminder: still in drafts",
  "brand_email.storefront_nudge": "Reminder: publish your storefront",
  "brand_email.website_pieces": "New from your website",
  "brand.storefront_published_by_yard": "Your shop is live (Yard published it)",
  "founding.claim_went_live": "You claimed it and you're live",
  "onboarding.rejected": "Application: changes needed",
  "onboarding.approved": "Application approved",
  "catalog.product_hidden": "Listing paused",
  "catalog.product_unhidden": "Listing back on Yard",
}
