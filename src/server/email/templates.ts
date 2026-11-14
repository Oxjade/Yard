import "server-only"
import { currencies, type CurrencyCode } from "@/config/markets"
import { formatMoney } from "@/lib/money"
import { getEnv } from "../env"
import { layoutHtml, layoutText, type EmailContent, type Fact, type Receipt, type ReceiptGroup, type ReceiptLine } from "./layout"

/**
 * Email templates (ENGAGEMENT v3). Subjects and bodies come only from here; callers pass short
 * variables (names, references, formatted amounts, dates, links). Every variable is HTML-escaped
 * and cut to 300 characters, and every link must be a Yard path or an absolute URL on Yard's own
 * origin, so a caller can't turn an email into a phishing link.
 */
export type EmailCategory = "account" | "orders" | "payouts" | "drops" | "price_drops" | "back_in_stock" | "brand_news"

/** Transactional mail ignores preferences (only bounces and complaints stop it). */
export const TRANSACTIONAL: ReadonlySet<EmailCategory> = new Set(["account", "orders", "payouts"])

type Vars = Record<string, string | number>
/** What a template describes. Plain strings only: layout.ts escapes everything; renderEmail checks links and images. */
type Built = {
  subject: string
  /** Inbox preview line. */
  preheader: string
  eyebrow?: string
  heading: string
  greeting?: string
  paragraphs: string[]
  action?: { label: string; url: string }
  /** Optional hero image: a Yard path or a URL on Yard's origin (anything else is dropped). */
  image?: string
  imageAlt?: string
  imageSize?: "full" | "product"
  facts?: Fact[]
  receipt?: Receipt | null
  steps?: { title: string; steps: string[] }
  note?: string
  showUrl?: boolean
  /** Footer "why you're getting this"; defaults per category. */
  why?: string
}
type Template = { category: EmailCategory; required: readonly string[]; build: (v: Vars) => Built }

const v = (vars: Vars, key: string, fallback = "") => String(vars[key] ?? fallback).slice(0, 300)
const has = (vars: Vars, key: string) => vars[key] !== undefined && vars[key] !== ""
/** "Hey Ada," (a person's first name, a brand's full name) — or nothing when there's no name (never a bare "Hi,"). */
const hey = (vars: Vars, key = "name") => {
  const n = v(vars, key).trim()
  return n ? `Hey ${key === "name" ? n.split(/\s+/)[0] : n},` : undefined
}
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
/** A link's lifetime in words: "15 minutes", "1 hour", "24 hours", "3 days" (a whole number of days from 48 hours up). */
const minutes = (x: Vars, fallback: string) => {
  const m = Math.round(Number(x.expiresMinutes))
  if (!(m > 0)) return fallback
  if (m < 60) return plural(m, "minute")
  if (m < 48 * 60 || m % (24 * 60) !== 0) return plural(Math.round(m / 60), "hour")
  return plural(m / (24 * 60), "day")
}
const facts = (...rows: (Fact | false | null | undefined)[]) => rows.filter((r): r is Fact => !!r && !!r.value)
const by = (x: Vars) => (has(x, "brand") ? ` by ${v(x, "brand")}` : "")
const heroOf = (x: Vars, alt: string, imageSize: "full" | "product" = "product") => (has(x, "image") ? { image: v(x, "image"), imageAlt: alt, imageSize } : {})

const WHY: Record<EmailCategory, string> = {
  account: "You're getting this because of activity on your Yard account.",
  orders: "You're getting this because you placed an order on Yard.",
  payouts: "You're getting this because you manage payouts for a brand on Yard.",
  drops: "You're getting this because you set a reminder or entered a draw on Yard.",
  price_drops: "You're getting this because you saved this piece on Yard.",
  back_in_stock: "You're getting this because you asked us to tell you when this piece came back.",
  brand_news: "You're getting this because you follow this brand on Yard.",
}

const RETURN_REASON_LABELS: Record<string, string> = { too_small: "Too small", too_large: "Too large", not_as_described: "Not as described", damaged: "Arrived damaged", wrong_item: "Wrong item sent", unwanted: "Changed their mind", other: "Other" }

/** The stage of a return, from `stage` or the free-text `status` ORDERS sends ("approved: …", "declined (reason)", "received by the brand; …"). */
function returnStage(x: Vars): { stage: "requested" | "approved" | "rejected" | "received" | "refunded" | "expired" | "other"; reason: string; refundPending: boolean } {
  const s = String(x.stage ?? x.status ?? "")
    .trim()
    .toLowerCase()
  // "declined (reason)": everything between the first "(" and the closing ")" (a reason may hold brackets itself).
  const paren = /^[^(]*\(([\s\S]{1,300})\)\s*$/.exec(String(x.status ?? ""))
  const reason = has(x, "reason") ? v(x, "reason") : (paren?.[1] ?? "")
  const refundPending = /refund/.test(s) && !/^refunded/.test(s)
  const stage = /^requested/.test(s) ? "requested" : /^approved/.test(s) ? "approved" : /^(declined|rejected)/.test(s) ? "rejected" : /^refunded/.test(s) ? "refunded" : /^received/.test(s) ? "received" : /^expired/.test(s) ? "expired" : "other"
  return { stage, reason, refundPending }
}

/* ---------- Order receipt (order_confirmation `items`) ---------- */

/**
 * Parses the optional `items` var: JSON written by ORDERS (orders/receipt-email.ts). Shape:
 * { groups: [{ brand, eta?, shipping?, lines: [{ title, variant?, qty, price?, image? }], more? }], subtotal?, shipping?, total?, shipTo?, placed? }.
 * Defensive: anything malformed gives null (the email falls back to the plain summary); every
 * string is cut to 300 characters here and escaped by the layout; images are checked in renderEmail.
 */
function parseReceipt(x: Vars): Receipt | null {
  if (typeof x.items !== "string" || !x.items || x.items.length > 12_000) return null
  let raw: unknown
  try {
    raw = JSON.parse(x.items)
  } catch {
    return null
  }
  const str = (val: unknown) => (typeof val === "string" && val.trim() ? val.trim().slice(0, 300) : undefined)
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { groups?: unknown }).groups)) return null
  const r = raw as Record<string, unknown>
  const groups: ReceiptGroup[] = []
  // At most 30 lines in all (each group shows at least one), so the email stays well under Gmail's 102KB clip.
  let budget = 30
  for (const g of (r.groups as unknown[]).slice(0, 10)) {
    if (!g || typeof g !== "object") continue
    const gg = g as Record<string, unknown>
    const brand = str(gg.brand)
    if (!brand || !Array.isArray(gg.lines)) continue
    const lines: ReceiptLine[] = []
    for (const l of (gg.lines as unknown[]).slice(0, Math.max(1, Math.min(12, budget)))) {
      if (!l || typeof l !== "object") continue
      const ll = l as Record<string, unknown>
      const title = str(ll.title)
      const qty = Number(ll.qty)
      if (!title || !Number.isInteger(qty) || qty < 1 || qty > 9999) continue
      lines.push({ title, variant: str(ll.variant), qty, price: str(ll.price), image: str(ll.image) ?? null })
    }
    if (!lines.length) continue
    budget -= lines.length
    const dropped = (gg.lines as unknown[]).length - lines.length
    const more = Math.max(0, Math.min(999, (Number.isInteger(gg.more) ? Number(gg.more) : 0) + Math.max(0, dropped)))
    groups.push({ brand, eta: str(gg.eta), shipping: str(gg.shipping), lines, ...(more ? { more } : {}) })
  }
  if (!groups.length) return null
  return { reference: v(x, "reference"), placed: str(r.placed), groups, subtotal: str(r.subtotal), shipping: str(r.shipping), total: str(r.total) ?? (has(x, "total") ? v(x, "total") : undefined), shipTo: str(r.shipTo) }
}

export const templates = {
  /* ---------- Account ---------- */
  verification: {
    category: "account",
    required: ["url"],
    build: (x) => ({
      subject: "Confirm your email for Yard",
      preheader: "One tap and you're in. The link works once.",
      eyebrow: "Welcome to Yard",
      heading: "Lock in your email",
      greeting: hey(x),
      paragraphs: ["Confirm this address to finish setting up your account. It's where your order updates, drop reminders and draw results land."],
      action: { label: "Confirm email", url: v(x, "url") },
      note: `The link works once and expires in ${minutes(x, "a little while")}. Didn't sign up? Ignore this and nothing happens.`,
      showUrl: true,
      why: "You're getting this because this address was used to sign up for Yard.",
    }),
  },
  reset: {
    category: "account",
    required: ["url"],
    build: (x) => ({
      subject: "Reset your Yard password",
      preheader: "Pick a new password. The link works once.",
      eyebrow: "Security",
      heading: "Reset your password",
      greeting: hey(x),
      paragraphs: ["Someone asked to reset the password on your Yard account. If that was you, choose a new one below."],
      action: { label: "Choose a new password", url: v(x, "url") },
      note: `The link works once and expires in ${minutes(x, "a little while")}. Not you? Ignore this: your password stays as it is.`,
      showUrl: true,
      why: "You're getting this because a password reset was requested for this Yard account.",
    }),
  },
  magic_link: {
    category: "account",
    required: ["url"],
    build: (x) => ({
      subject: "Your Yard sign-in link",
      preheader: "Tap to sign in. No password needed.",
      eyebrow: "Sign in",
      heading: "Tap in",
      greeting: hey(x),
      paragraphs: ["Here's your one-time link to sign in to Yard."],
      action: { label: "Sign in to Yard", url: v(x, "url") },
      note: `Works once and expires in ${minutes(x, "a few minutes")}. Didn't ask for it? Ignore this email.`,
      showUrl: true,
      why: "You're getting this because a sign-in link was requested for this address.",
    }),
  },
  password_changed: {
    category: "account",
    required: [],
    build: (x) => ({
      subject: "Your Yard password was changed",
      preheader: "If this was you, you're set. If not, act now.",
      eyebrow: "Security",
      heading: "Password changed",
      greeting: hey(x),
      paragraphs: ["The password on your Yard account was just changed.", "If that was you, there's nothing else to do. If it wasn't, reset it right away and email support so we can lock the account down."],
      action: { label: "Secure my account", url: "/sign-in" },
    }),
  },
  email_change: {
    category: "account",
    required: ["url"],
    build: (x) => ({
      subject: "Confirm your new email for Yard",
      preheader: "One tap moves your Yard account to this address.",
      eyebrow: "Account",
      heading: "Confirm your new email",
      greeting: hey(x),
      paragraphs: ["You asked to move your Yard account to this address. Confirm it and your sign-in email, order updates and receipts switch here.", "Until you confirm, nothing changes: your account keeps its current email."],
      action: { label: "Confirm new email", url: v(x, "url") },
      note: `The link works once and expires in ${minutes(x, "a day")}. Didn't ask for this? Ignore this email and nothing changes.`,
      showUrl: true,
      why: "You're getting this because someone asked to move a Yard account to this address.",
    }),
  },
  email_changed: {
    category: "account",
    required: ["email"],
    build: (x) => ({
      subject: "Your Yard email was changed",
      preheader: "Your account now uses a different email address.",
      eyebrow: "Security",
      heading: "Your email was changed",
      greeting: hey(x),
      paragraphs: [`The email on your Yard account was just changed to ${v(x, "email")}. Sign-in links, order updates and receipts now go there.`, "If that was you, there's nothing else to do. If it wasn't, reset your password right away and message Yard Support so we can lock the account down."],
      action: { label: "Secure my account", url: "/sign-in" },
      why: "You're getting this because this address was the email on a Yard account until just now.",
    }),
  },
  team_invite: {
    category: "account",
    required: ["brand", "url"],
    build: (x) => ({
      subject: has(x, "inviter") ? `${v(x, "inviter")} invited you to ${v(x, "brand")} on Yard` : `You're invited to join ${v(x, "brand")} on Yard`,
      preheader: `Join the ${v(x, "brand")} team in Yard Studio.`,
      eyebrow: "Yard Studio",
      heading: `Join ${v(x, "brand")}`,
      greeting: hey(x),
      paragraphs: [`${v(x, "inviter", "A teammate")} wants you on the ${v(x, "brand")} team${has(x, "role") ? ` as ${v(x, "role")}` : ""}.`, "Studio is where the brand runs its drops, orders, shipping and payouts."],
      facts: facts({ label: "Brand", value: v(x, "brand") }, has(x, "role") && { label: "Role", value: v(x, "role") }, has(x, "inviter") && { label: "Invited by", value: v(x, "inviter") }),
      action: { label: "Accept invite", url: v(x, "url") },
      note: `${Number(x.expiresDays) > 0 ? `The invite expires in ${plural(Number(x.expiresDays), "day")}.` : "The invite expires in a few days."} Not expecting it? Ignore this email.`,
      showUrl: true,
      why: "You're getting this because a brand on Yard invited this address to its team.",
    }),
  },
  brand_approved: {
    category: "account",
    required: ["brand"],
    build: (x) => ({
      subject: `You're approved: ${v(x, "brand")} can sell on Yard`,
      preheader: `Welcome to Yard. ${v(x, "brand")} is approved, so start creating as soon as you can.`,
      eyebrow: "Yard Studio",
      heading: "You're approved",
      greeting: hey(x),
      paragraphs: [
        `Welcome to Yard. We've reviewed ${v(x, "brand")} and you're approved to sell.`,
        "Start creating as soon as you can: add your pieces with photos, sizes and stock, dress up your storefront, and plan your first drop so your followers are there the moment it opens.",
        "Before your first sale, add your payout account in Studio so your earnings reach you.",
        "Need guidance at any point? Message @support, the Yard team, from Yard Support in the Studio sidebar. We reply right there in Studio.",
      ],
      facts: facts({ label: "Brand", value: v(x, "brand") }, has(x, "handle") && { label: "Storefront", value: `@${v(x, "handle")}` }),
      action: { label: "Open Brand Studio", url: has(x, "url") ? v(x, "url") : "/studio" },
      why: "You're getting this because you applied to sell on Yard with this address.",
    }),
  },
  founding_claim: {
    category: "account",
    required: ["brand", "url"],
    build: (x) => ({
      subject: `You're one of Yard's founding brands: ${v(x, "brand")} is ready to claim`,
      preheader: `Your store is ready, claim it. ${v(x, "brand")} is set up on Yard and waiting for you.`,
      eyebrow: "Founding brand",
      heading: "Your store is ready, claim it",
      greeting: hey(x),
      paragraphs: [
        `Thank you for being one of the first brands on Yard. Founding brands like ${v(x, "brand")} are the reason Yard exists, and we're proud to launch with you.`,
        `We've set up ${v(x, "brand")} on Yard with your products, photos and storefront, so it's ready the day you arrive.`,
        "Claim it to become its owner: sign in or create your account, accept the seller agreement, then add your payout account. Selling switches on as soon as your payout account is in.",
      ],
      facts: facts(
        { label: "Brand", value: v(x, "brand") },
        has(x, "handle") && { label: "Handle", value: `@${v(x, "handle")}` },
        { label: "Link expires", value: Number(x.expiresDays) > 0 ? `in ${plural(Number(x.expiresDays), "day")}` : "in a few days" },
      ),
      action: { label: "Claim my store", url: v(x, "url") },
      note: "This link works once and only for this email address. Not expecting it? Ignore this email and nothing changes.",
      showUrl: true,
      why: "You're getting this because Yard set up a store for your brand and named this address as its owner. Thank you for building Yard with us.",
    }),
  },
  account_deleted: {
    category: "account",
    required: [],
    build: (x) => ({
      subject: "Your Yard account is deleted",
      preheader: "Your profile is gone. Here's what we keep, and why.",
      eyebrow: "Account",
      heading: "Account deleted",
      greeting: hey(x),
      paragraphs: ["Your Yard account is closed and your personal data is being erased.", "Order records we're required by law to keep stay on file, with your profile detached.", "Thanks for being part of the Yard. The door's open if you ever want back in."],
      why: "You're getting this to confirm your Yard account was deleted. It's the last email we'll send.",
    }),
  },
  mfa_reset: {
    category: "account",
    required: [],
    build: (x) => ({
      subject: "Two-step verification was reset on your Yard admin account",
      preheader: "Your admin sessions were signed out. Set up a new authenticator at next sign-in.",
      eyebrow: "Security",
      heading: "Two-step verification reset",
      greeting: hey(x),
      paragraphs: ["An owner reset two-step verification on your Yard admin account, and every admin session you had open was signed out.", "Next time you sign in, you'll scan a new code with your authenticator app and get fresh recovery codes."],
      action: { label: "Sign in to Admin", url: "/admin" },
      note: "Didn't ask for this? Tell the Yard owner team right away.",
      why: "You're getting this because you're a Yard admin and your account security changed.",
    }),
  },

  /* ---------- Orders ---------- */
  order_confirmation: {
    category: "orders",
    required: ["reference", "url"],
    build: (x) => {
      const receipt = parseReceipt(x)
      const brands = has(x, "brands") ? v(x, "brands") : ""
      return {
        subject: `Order ${v(x, "reference")} confirmed`,
        preheader: `${has(x, "total") ? `${v(x, "total")} · ` : ""}${brands ? `${brands}. ` : ""}We'll email you as each brand ships.`,
        eyebrow: "Order confirmed",
        heading: "It's yours.",
        greeting: hey(x),
        paragraphs: [`Payment's in for order ${v(x, "reference")}. Each brand packs and ships its own part, and we'll let you know as each one leaves.`],
        receipt,
        facts: receipt ? undefined : facts({ label: "Order", value: v(x, "reference") }, has(x, "total") && { label: "Total", value: v(x, "total") }, !!brands && { label: Number(x.orders) > 1 ? "Brands" : "Brand", value: brands }),
        action: { label: "View order", url: v(x, "url") },
      }
    },
  },
  order_cancelled: {
    category: "orders",
    required: ["reference", "url"],
    build: (x) => {
      const who = String(x.by ?? "")
      const brand = v(x, "brand", "The brand")
      const lead = who === "shopper" ? `You cancelled order ${v(x, "reference")}.` : who === "brand" ? `${brand} cancelled order ${v(x, "reference")} before it shipped.` : who === "admin" ? `Yard cancelled order ${v(x, "reference")}.` : `Order ${v(x, "reference")} was cancelled.`
      const money = has(x, "amount") ? `A full refund of ${v(x, "amount")} is heading back to your original payment method. You'll get a separate email once it's sent.` : Number(x.charged) === 0 ? "You weren't charged for it." : "If you were charged, a full refund follows automatically."
      return {
        subject: `Order ${v(x, "reference")} cancelled`,
        preheader: has(x, "amount") ? `Your refund of ${v(x, "amount")} is on its way.` : "Nothing ships. Here's what happens next.",
        eyebrow: `Order ${v(x, "reference")}`,
        heading: "Order cancelled",
        greeting: hey(x),
        paragraphs: [lead, money],
        facts: facts({ label: "Order", value: v(x, "reference") }, has(x, "brand") && { label: "Brand", value: v(x, "brand") }, has(x, "reason") && who !== "shopper" && { label: "Reason", value: v(x, "reason") }, has(x, "amount") && { label: "Refund", value: v(x, "amount") }),
        action: { label: "View order", url: v(x, "url") },
      }
    },
  },
  shipped: {
    category: "orders",
    required: ["reference", "url"],
    build: (x) => ({
      subject: `${v(x, "brand", "Your order")} has shipped`,
      preheader: has(x, "tracking") ? `${has(x, "carrier") ? `${v(x, "carrier")} · ` : ""}Tracking ${v(x, "tracking")}` : has(x, "range") ? `Arriving ${v(x, "range")}.` : "Your order is on the move.",
      eyebrow: "Shipped",
      heading: "On the move",
      greeting: hey(x),
      paragraphs: [`${v(x, "brand", "The brand")} just shipped ${has(x, "brand") ? "their part of " : ""}order ${v(x, "reference")}.`, has(x, "tracking") ? "Use the tracking number with the carrier, or follow it from your order page." : "Follow it from your order page."],
      facts: facts({ label: "Order", value: v(x, "reference") }, has(x, "carrier") && { label: "Carrier", value: v(x, "carrier") }, has(x, "tracking") && { label: "Tracking", value: v(x, "tracking") }, has(x, "range") && { label: "Arrives", value: v(x, "range") }),
      action: { label: "Track order", url: v(x, "url") },
    }),
  },
  refund: {
    category: "orders",
    required: ["reference", "amount", "url"],
    build: (x) => ({
      subject: `Refund of ${v(x, "amount")} for order ${v(x, "reference")}`,
      preheader: "Heading back to the way you paid. Banks can take a few days.",
      eyebrow: "Refund",
      heading: "Refund sent",
      greeting: hey(x),
      paragraphs: [`We've refunded ${v(x, "amount")} for order ${v(x, "reference")}.`, "It goes back to the way you paid. It can take a few business days to show on your statement."],
      facts: facts({ label: "Order", value: v(x, "reference") }, { label: "Refund", value: v(x, "amount") }),
      action: { label: "View order", url: v(x, "url") },
    }),
  },
  return_update: {
    category: "orders",
    required: ["reference", "status", "url"],
    build: (x) => {
      const ref = v(x, "reference")
      const { stage, reason, refundPending } = returnStage(x)
      const base = { greeting: hey(x), action: { label: "View order", url: v(x, "url") } }
      switch (stage) {
        case "requested":
          return { ...base, subject: `Return requested for order ${ref}`, preheader: "The brand has it. We'll tell you the moment they decide.", eyebrow: "Return", heading: "Return requested", paragraphs: [`We've sent your return request for order ${ref} to the brand.`, "They'll approve or decline it, and we'll email you as soon as they do. Keep the items as they arrived until then."] }
        case "approved":
          return {
            ...base,
            subject: `Return approved for order ${ref}`,
            preheader: "Approved. Here's how to send it back.",
            eyebrow: "Return approved",
            heading: "Approved. Send it back.",
            paragraphs: [`The brand approved your return for order ${ref}.`],
            steps: { title: "How to send it back", steps: ["Pack the items unworn, with tags and original packaging.", "Open your order on Yard for the brand's return address, and ship within 30 days.", "Keep proof of postage. Your refund is issued once the brand receives it."] },
          }
        case "rejected":
          return { ...base, subject: `Return declined for order ${ref}`, preheader: reason ? `Reason: ${reason}` : "The brand declined your return.", eyebrow: "Return", heading: "Return declined", paragraphs: [`The brand declined your return for order ${ref}.`, "Think that's wrong? Message the brand from your order, or reach Yard support and we'll take a look."], facts: facts(!!reason && { label: "Reason", value: reason }) }
        case "received":
          return { ...base, subject: `Return received for order ${ref}`, preheader: refundPending ? "The brand has it. Your refund is being processed." : "The brand has your return.", eyebrow: "Return", heading: "Return received", paragraphs: [`The brand received your return for order ${ref}.`, refundPending ? "Your refund is being processed. You'll get a separate email once it's sent." : "If a refund is due, you'll get a separate email when it's issued."] }
        case "refunded":
          return { ...base, subject: `Return refunded for order ${ref}`, preheader: has(x, "amount") ? `${v(x, "amount")} is heading back to you.` : "Your refund is on its way.", eyebrow: "Return", heading: "Return complete", paragraphs: [`Your return for order ${ref} is done and the refund${has(x, "amount") ? ` of ${v(x, "amount")}` : ""} is on its way.`, "It can take a few business days to show on your statement."] }
        case "expired":
          return { ...base, subject: `Return closed for order ${ref}`, preheader: "We didn't see it arrive within 30 days.", eyebrow: "Return", heading: "Return closed", paragraphs: [`Your approved return for order ${ref} didn't reach the brand within 30 days, so we've closed it.`, "Already sent it, or still want to? Message the brand from your order."] }
        default:
          return { ...base, subject: `Return update for order ${ref}`, preheader: `Your return is now: ${v(x, "status")}`, eyebrow: "Return", heading: "Return update", paragraphs: [`Your return for order ${ref} is now: ${v(x, "status")}.`] }
      }
    },
  },
  return_requested: {
    category: "orders",
    required: ["reference", "url"],
    build: (x) => {
      const units = Number(x.units) > 0 ? Number(x.units) : 0
      const reason = RETURN_REASON_LABELS[String(x.reason ?? "")] ?? (has(x, "reason") ? v(x, "reason") : "")
      return {
        subject: `Return requested on order ${v(x, "reference")}`,
        preheader: `${units ? `${plural(units, "item")} · ` : ""}${reason ? `${reason}. ` : ""}Approve or decline it in Studio.`,
        eyebrow: "Studio · Returns",
        heading: "A return needs your call",
        greeting: hey(x, "brand"),
        paragraphs: [`A shopper asked to return ${units ? plural(units, "item") : "items"} from order ${v(x, "reference")}.`, "Approve or decline it in Studio. Once you approve, they ship it back to you and you refund on arrival."],
        facts: facts({ label: "Order", value: v(x, "reference") }, !!reason && { label: "Reason", value: reason }, !!units && { label: "Items", value: String(units) }, has(x, "note") && { label: "Their note", value: v(x, "note") }),
        action: { label: "Review return", url: v(x, "url") },
        why: has(x, "brand") ? `You're getting this because you're an owner of ${v(x, "brand")} on Yard.` : "You're getting this because you own a brand on Yard.",
      }
    },
  },

  /* ---------- Payouts ---------- */
  payout: {
    category: "payouts",
    required: ["amount", "url"],
    build: (x) => {
      const outcome = String(x.outcome ?? x.status ?? "paid")
      const amount = v(x, "amount")
      const lines: Record<string, Pick<Built, "subject" | "preheader" | "eyebrow" | "heading" | "paragraphs">> = {
        paid: { subject: `Payout of ${amount} sent`, preheader: "On its way to your bank. Usually there within a business day.", eyebrow: "Payout sent", heading: `${amount} is on its way`, paragraphs: ["We've sent your payout to your bank account. Most banks show it within one business day."] },
        failed: { subject: `Payout of ${amount} didn't go through`, preheader: "The money's safe: it's back in your balance.", eyebrow: "Payout failed", heading: "Payout didn't go through", paragraphs: [`Your payout of ${amount} couldn't be delivered.`, "The money is safe and back in your available balance. Check your bank details in Studio, then request it again."] },
        rejected: { subject: `Payout of ${amount} wasn't approved`, preheader: "Back in your balance. Open Payouts for the reason.", eyebrow: "Payout not approved", heading: "Payout not approved", paragraphs: [`Yard didn't approve the payout of ${amount}.`, "The amount is back in your available balance. Open Payouts in Studio to see why and what to fix."] },
        reversed: { subject: `Payout of ${amount} was reversed`, preheader: "Your bank sent it back. It's in your balance again.", eyebrow: "Payout reversed", heading: "Payout reversed", paragraphs: [`Your bank returned the payout of ${amount}.`, "It's back in your available balance. This usually means the account details changed, so check them in Studio before requesting again."] },
      }
      const l = lines[outcome === "sent" || outcome === "succeeded" ? "paid" : outcome] ?? lines.paid
      return {
        ...l,
        greeting: hey(x, "brand"),
        facts: facts({ label: "Amount", value: amount }, has(x, "brand") && { label: "Brand", value: v(x, "brand") }, has(x, "payoutId") && { label: "Reference", value: v(x, "payoutId") }),
        action: { label: "Open payouts", url: v(x, "url") },
        why: has(x, "brand") ? `You're getting this because you manage payouts for ${v(x, "brand")} on Yard.` : WHY.payouts,
      }
    },
  },

  /* ---------- Drops ---------- */
  drop_reminder: {
    category: "drops",
    required: ["drop", "url"],
    build: (x) => ({
      subject: `${v(x, "drop")} drops ${has(x, "when") ? v(x, "when") : "soon"}`,
      preheader: `${v(x, "brand", "The brand")} releases ${v(x, "drop")} ${has(x, "when") ? v(x, "when") : "soon"}. Be ready.`,
      eyebrow: "Dropping soon",
      heading: v(x, "drop"),
      ...heroOf(x, v(x, "drop"), "full"),
      greeting: hey(x),
      paragraphs: [`${v(x, "brand", "The brand")} releases ${v(x, "drop")} ${has(x, "when") ? v(x, "when") : "soon"}. You asked for a heads-up, so this is it.`, "Quantities are limited and they move fast."],
      facts: facts(has(x, "brand") && { label: "Brand", value: v(x, "brand") }, has(x, "when") && { label: "Release", value: v(x, "when").replace(/^on\s+/, "") }),
      action: { label: "Open the drop", url: v(x, "url") },
    }),
  },
  drop_live: {
    category: "drops",
    required: ["drop", "url"],
    build: (x) => ({
      subject: `${v(x, "drop")} is live`,
      preheader: `${v(x, "brand", "The brand")} just dropped ${v(x, "drop")}. Limited run.`,
      eyebrow: "Live now",
      heading: `${v(x, "drop")} is live`,
      ...heroOf(x, v(x, "drop"), "full"),
      greeting: hey(x),
      paragraphs: [`${v(x, "brand", "The brand")} just released ${v(x, "drop")}.`, "Limited quantities. When it's gone, it's gone."],
      action: { label: "Shop the drop", url: v(x, "url") },
    }),
  },
  drop_draw_won: {
    category: "drops",
    required: ["drop", "url"],
    build: (x) => {
      const until = has(x, "until") ? v(x, "until") : has(x, "deadline") ? v(x, "deadline") : ""
      // `opens`: the window starts later (at release), so the button can't buy yet.
      const opens = has(x, "opens") ? v(x, "opens") : ""
      return {
        subject: `You won the ${v(x, "drop")} draw`,
        preheader: opens ? `Your purchase window opens ${opens}. Don't sleep on it.` : until ? `Your spot is held until ${until}. Don't sleep on it.` : "Your spot is held. Don't sleep on it.",
        eyebrow: "Draw result",
        heading: "You're in.",
        ...heroOf(x, v(x, "drop")),
        greeting: hey(x),
        paragraphs: [
          `You were drawn for ${v(x, "drop")}.`,
          opens
            ? `Your purchase window opens ${opens}${until ? ` and closes ${until}` : ""}. Buy in that window, or your spot passes to the next person on the list.`
            : `Complete your purchase ${until ? `before ${until}` : "within your purchase window"}, or your spot passes to the next person on the list.`,
        ],
        facts: facts({ label: "Drop", value: v(x, "drop") }, !!opens && { label: "Window opens", value: opens }, !!until && { label: "Buy before", value: until }),
        action: { label: "Complete purchase", url: v(x, "url") },
      }
    },
  },
  drop_draw_lost: {
    category: "drops",
    required: ["drop", "url"],
    build: (x) => ({
      subject: `${v(x, "drop")}: draw results`,
      preheader: "Not this time, but you're on the waitlist.",
      eyebrow: "Draw result",
      heading: "Not this time",
      ...heroOf(x, v(x, "drop")),
      greeting: hey(x),
      paragraphs: [`You weren't drawn for ${v(x, "drop")}.`, "You're on the waitlist. If a winner doesn't buy in time, spots move down the list and we'll email you straight away."],
      action: { label: "See the drop", url: v(x, "url") },
    }),
  },

  /* ---------- Watches ---------- */
  price_drop: {
    category: "price_drops",
    required: ["product", "price", "url"],
    build: (x) => {
      const was = has(x, "was") ? v(x, "was") : has(x, "wasPrice") ? v(x, "wasPrice") : ""
      return {
        subject: `Price drop: ${v(x, "product")}`,
        preheader: `Now ${v(x, "price")}${was ? `, was ${was}` : ""}. Saved pieces at this price don't hang around.`,
        eyebrow: "Price drop",
        heading: "Your saved piece just got cheaper",
        ...heroOf(x, v(x, "product")),
        greeting: hey(x),
        paragraphs: [`${v(x, "product")}${by(x)} is now ${v(x, "price")}${was ? `, down from ${was}` : ""}.`],
        facts: facts({ label: "Now", value: v(x, "price") }, !!was && { label: "Was", value: was }),
        action: { label: "Shop it now", url: v(x, "url") },
      }
    },
  },
  back_in_stock: {
    category: "back_in_stock",
    required: ["product", "url"],
    build: (x) => {
      const variant = has(x, "variant") ? v(x, "variant") : has(x, "size") ? `Size ${v(x, "size")}` : ""
      return {
        subject: `Back in stock: ${v(x, "product")}`,
        preheader: `${v(x, "product")}${variant ? ` (${variant})` : ""} is back. Restocks are small.`,
        eyebrow: "Back in stock",
        heading: "It's back.",
        ...heroOf(x, v(x, "product")),
        greeting: hey(x),
        paragraphs: [`${v(x, "product")}${variant ? ` in ${variant}` : ""}${by(x)} is back in stock.`, "Restocks are usually small. If you want it, now's the time."],
        action: { label: "Shop it now", url: v(x, "url") },
      }
    },
  },
} satisfies Record<string, Template>

export type EmailTemplateKey = keyof typeof templates

/** Other spellings callers may use for the same template. */
const ALIASES: Record<string, EmailTemplateKey> = {
  verify: "verification",
  verify_email: "verification",
  email_verification: "verification",
  email_verify: "verification",
  auth_verify_email: "verification",
  auth_verification: "verification",
  password_reset: "reset",
  reset_password: "reset",
  auth_reset: "reset",
  auth_password_reset: "reset",
  magic: "magic_link",
  auth_magic_link: "magic_link",
  invite: "team_invite",
  team_invitation: "team_invite",
  brand_invite: "team_invite",
  claim: "founding_claim",
  founding: "founding_claim",
  order_confirmed: "order_confirmation",
  order: "order_confirmation",
  order_shipped: "shipped",
  refund_processed: "refund",
  order_refund: "refund",
  payout_sent: "payout",
  payout_failed: "payout",
  drop: "drop_reminder",
  reminder: "drop_reminder",
  order_canceled: "order_cancelled",
  order_cancel: "order_cancelled",
  cancelled: "order_cancelled",
  return_request: "return_requested",
  return_requested_brand: "return_requested",
  mfa: "mfa_reset",
  admin_mfa_reset: "mfa_reset",
}

/** The canonical template key for a caller's name ("order.shipped", "password-reset", …), or null. */
export function resolveTemplate(name: string): EmailTemplateKey | null {
  const k = name
    .trim()
    .toLowerCase()
    .replace(/[.\-\s/]+/g, "_")
  if (k in templates) return k as EmailTemplateKey
  return ALIASES[k] ?? null
}

/** A Yard link: a path becomes absolute on the public origin; an absolute URL must be on that origin. Anything else is dropped. */
export function safeLink(url: string): string | null {
  const origin = getEnv().publicOrigin
  if (url.startsWith("/") && !url.startsWith("//")) return `${origin}${url}`
  try {
    const u = new URL(url)
    return u.origin === origin ? u.toString() : null
  } catch {
    return null
  }
}

/** Default links per category when a caller sends none. */
const DEFAULT_URL: Partial<Record<EmailCategory, string>> = { orders: "/you/orders", payouts: "/studio/payouts", drops: "/drops", price_drops: "/wishlist", back_in_stock: "/wishlist" }

/**
 * Fills variables callers commonly send in another form: `amount` from amountMinor + currency,
 * `brand` from brandName, a default `url` for the category.
 */
export function normalizeVars(key: EmailTemplateKey, vars: Vars): Vars {
  const out: Vars = { ...vars }
  if ((out.amount === undefined || out.amount === "") && typeof out.amountMinor === "number" && typeof out.currency === "string" && out.currency in currencies) out.amount = formatMoney(out.amountMinor, out.currency as CurrencyCode)
  if ((out.brand === undefined || out.brand === "") && out.brandName) out.brand = out.brandName
  if ((out.url === undefined || out.url === "") && DEFAULT_URL[templates[key].category]) out.url = DEFAULT_URL[templates[key].category]!
  return out
}

export type Rendered = { subject: string; text: string; html: string; category: EmailCategory }

/** Renders a template. `unsubscribeUrl` is added to optional (non-transactional) mail. */
export function renderEmail(key: EmailTemplateKey, vars: Vars, opts: { unsubscribeUrl?: string | null } = {}): Rendered {
  const t: Template = templates[key]
  vars = normalizeVars(key, vars)
  const missing = t.required.filter((k) => vars[k] === undefined || vars[k] === "")
  if (missing.length) throw new Error(`email template ${key} is missing ${missing.join(", ")}`)
  const b = t.build(vars)
  const action = b.action ? { label: b.action.label, url: safeLink(b.action.url) } : null
  if (b.action && !action?.url) throw new Error(`email template ${key}: the link must be a Yard path or a URL on Yard's origin`)
  // Images are optional: one that isn't on Yard's origin is dropped, never rendered.
  const hero = b.image ? safeLink(b.image) : null
  const receipt = b.receipt ? { ...b.receipt, groups: b.receipt.groups.map((g) => ({ ...g, lines: g.lines.map((l) => ({ ...l, image: l.image ? safeLink(l.image) : null })) })) } : null
  const content: EmailContent = {
    preheader: b.preheader,
    eyebrow: b.eyebrow,
    heading: b.heading,
    greeting: b.greeting,
    paragraphs: b.paragraphs,
    hero: hero ? { src: hero, alt: b.imageAlt ?? "", size: b.imageSize ?? "product" } : null,
    facts: b.facts,
    receipt,
    steps: b.steps ?? null,
    action: action ? { label: action.label, url: action.url! } : null,
    showUrl: b.showUrl,
    note: b.note,
    why: b.why ?? WHY[t.category],
    unsubscribeUrl: opts.unsubscribeUrl ?? null,
  }
  // One line, whatever a variable held (a subject is a mail header).
  const subject = b.subject.replace(/\s+/g, " ").trim()
  return { subject, text: layoutText(content), html: layoutHtml(content), category: t.category }
}

export function templateCategory(key: EmailTemplateKey): EmailCategory {
  return (templates[key] as Template).category
}
