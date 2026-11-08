import "server-only"
import { currencies, type CurrencyCode } from "@/config/markets"
import { formatMoney } from "@/lib/money"
import { getEnv } from "../env"

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
type Built = { subject: string; heading: string; paragraphs: string[]; action?: { label: string; url: string } }
type Template = { category: EmailCategory; required: readonly string[]; build: (v: Vars) => Built }

const v = (vars: Vars, key: string, fallback = "") => String(vars[key] ?? fallback).slice(0, 300)
const hello = (vars: Vars) => (vars.name ? `Hi ${v(vars, "name")},` : "Hi,")

export const templates = {
  verification: {
    category: "account",
    required: ["url"],
    build: (x) => ({ subject: "Confirm your email for Yard", heading: "Confirm your email", paragraphs: [hello(x), "Confirm this address to finish setting up your Yard account. The link expires soon and works once.", "If you didn't create an account, ignore this email."], action: { label: "Confirm email", url: v(x, "url") } }),
  },
  reset: {
    category: "account",
    required: ["url"],
    build: (x) => ({ subject: "Reset your Yard password", heading: "Reset your password", paragraphs: [hello(x), "Someone asked to reset the password on your Yard account. The link expires soon and works once.", "If it wasn't you, ignore this email: your password stays the same."], action: { label: "Choose a new password", url: v(x, "url") } }),
  },
  magic_link: {
    category: "account",
    required: ["url"],
    build: (x) => ({ subject: "Your Yard sign-in link", heading: "Sign in to Yard", paragraphs: [hello(x), "Use this link to sign in. It expires soon and works once.", "If you didn't ask for it, ignore this email."], action: { label: "Sign in", url: v(x, "url") } }),
  },
  password_changed: {
    category: "account",
    required: [],
    build: (x) => ({ subject: "Your Yard password was changed", heading: "Password changed", paragraphs: [hello(x), "The password on your Yard account was just changed. If this wasn't you, reset it now and contact support."] }),
  },
  team_invite: {
    category: "account",
    required: ["brand", "url"],
    build: (x) => ({ subject: `You're invited to ${v(x, "brand")} on Yard`, heading: `Join ${v(x, "brand")} on Yard`, paragraphs: [hello(x), `${v(x, "inviter", "A teammate")} invited you to join ${v(x, "brand")}${x.role ? ` as ${v(x, "role")}` : ""} in Yard Studio.`, "The invitation expires in a few days."], action: { label: "Accept invitation", url: v(x, "url") } }),
  },
  account_deleted: {
    category: "account",
    required: [],
    build: (x) => ({ subject: "Your Yard account was deleted", heading: "Account deleted", paragraphs: [hello(x), "Your Yard account has been deleted and your personal data is being erased. Order records we must keep by law are kept without your profile."] }),
  },
  order_confirmation: {
    category: "orders",
    required: ["reference", "url"],
    build: (x) => ({ subject: `Order ${v(x, "reference")} confirmed`, heading: "Thanks for your order", paragraphs: [hello(x), `We've received your payment for order ${v(x, "reference")}${x.total ? ` (${v(x, "total")})` : ""}.`, "Each brand ships its part separately; we'll email you when they do."], action: { label: "View order", url: v(x, "url") } }),
  },
  shipped: {
    category: "orders",
    required: ["reference", "url"],
    build: (x) => ({ subject: `${v(x, "brand", "Your order")} has shipped`, heading: "On its way", paragraphs: [hello(x), `${v(x, "brand", "The brand")} shipped order ${v(x, "reference")}.${x.carrier ? ` Carrier: ${v(x, "carrier")}.` : ""}${x.tracking ? ` Tracking: ${v(x, "tracking")}.` : ""}`, x.range ? `Estimated arrival ${v(x, "range")}.` : "Track it from your order page."], action: { label: "Track order", url: v(x, "url") } }),
  },
  refund: {
    category: "orders",
    required: ["reference", "amount", "url"],
    build: (x) => ({ subject: `Refund for order ${v(x, "reference")}`, heading: "Your refund is on its way", paragraphs: [hello(x), `We've refunded ${v(x, "amount")} for order ${v(x, "reference")}. It can take a few business days to show on your statement.`], action: { label: "View order", url: v(x, "url") } }),
  },
  return_update: {
    category: "orders",
    required: ["reference", "status", "url"],
    build: (x) => ({ subject: `Return update for order ${v(x, "reference")}`, heading: "Return update", paragraphs: [hello(x), `Your return for order ${v(x, "reference")} is now: ${v(x, "status")}.`], action: { label: "View order", url: v(x, "url") } }),
  },
  payout: {
    category: "payouts",
    required: ["amount", "url"],
    build: (x) => {
      const outcome = String(x.outcome ?? x.status ?? "paid")
      const forBrand = x.brand ? ` for ${v(x, "brand")}` : ""
      const lines: Record<string, { subject: string; heading: string; body: string }> = {
        paid: { subject: `Payout of ${v(x, "amount")} sent`, heading: "Payout sent", body: `We've sent ${v(x, "amount")}${forBrand} to your bank account. It can take a business day to arrive.` },
        failed: { subject: `Payout of ${v(x, "amount")} failed`, heading: "Payout failed", body: `Your payout of ${v(x, "amount")}${forBrand} didn't go through. Check your bank details in Studio; the amount is back in your available balance.` },
        rejected: { subject: `Payout of ${v(x, "amount")} wasn't approved`, heading: "Payout not approved", body: `Yard didn't approve the payout of ${v(x, "amount")}${forBrand}. The amount is back in your available balance; open Payouts for the reason.` },
        reversed: { subject: `Payout of ${v(x, "amount")} was reversed`, heading: "Payout reversed", body: `Your bank returned the payout of ${v(x, "amount")}${forBrand}. The amount is back in your available balance. Check your bank details in Studio.` },
      }
      const l = lines[outcome === "sent" || outcome === "succeeded" ? "paid" : outcome] ?? lines.paid
      return { subject: l.subject, heading: l.heading, paragraphs: [hello(x), l.body], action: { label: "Open payouts", url: v(x, "url") } }
    },
  },
  drop_reminder: {
    category: "drops",
    required: ["drop", "url"],
    build: (x) => ({ subject: `${v(x, "drop")} drops ${x.when ? v(x, "when") : "soon"}`, heading: `${v(x, "drop")} is about to drop`, paragraphs: [hello(x), `${v(x, "brand", "The brand")} releases ${v(x, "drop")}${x.when ? ` ${v(x, "when")}` : " soon"}. You asked us to remind you.`], action: { label: "Open the drop", url: v(x, "url") } }),
  },
  drop_live: {
    category: "drops",
    required: ["drop", "url"],
    build: (x) => ({ subject: `${v(x, "drop")} is live`, heading: `${v(x, "drop")} is live`, paragraphs: [hello(x), `${v(x, "brand", "The brand")} just released ${v(x, "drop")}. Quantities are limited.`], action: { label: "Shop the drop", url: v(x, "url") } }),
  },
  drop_draw_won: {
    category: "drops",
    required: ["drop", "url"],
    build: (x) => ({ subject: `You won the ${v(x, "drop")} draw`, heading: "You're in", paragraphs: [hello(x), `You were drawn for ${v(x, "drop")}. Complete your purchase${x.until ? ` before ${v(x, "until")}` : " within your purchase window"}, or your place passes to the next person.`], action: { label: "Buy now", url: v(x, "url") } }),
  },
  drop_draw_lost: {
    category: "drops",
    required: ["drop", "url"],
    build: (x) => ({ subject: `${v(x, "drop")} draw results`, heading: "Not this time", paragraphs: [hello(x), `You weren't drawn for ${v(x, "drop")}. If a winner doesn't buy in time, places pass down the list and we'll email you.`], action: { label: "See the drop", url: v(x, "url") } }),
  },
  price_drop: {
    category: "price_drops",
    required: ["product", "price", "url"],
    build: (x) => ({ subject: `Price drop: ${v(x, "product")}`, heading: "A piece you saved is cheaper", paragraphs: [hello(x), `${v(x, "product")}${x.brand ? ` by ${v(x, "brand")}` : ""} is now ${v(x, "price")}${x.was ? ` (was ${v(x, "was")})` : ""}.`], action: { label: "View piece", url: v(x, "url") } }),
  },
  back_in_stock: {
    category: "back_in_stock",
    required: ["product", "url"],
    build: (x) => ({ subject: `Back in stock: ${v(x, "product")}`, heading: "It's back", paragraphs: [hello(x), `${v(x, "product")}${x.variant ? ` (${v(x, "variant")})` : ""}${x.brand ? ` by ${v(x, "brand")}` : ""} is back in stock. Quantities may be limited.`], action: { label: "View piece", url: v(x, "url") } }),
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
  order_confirmed: "order_confirmation",
  order: "order_confirmation",
  order_shipped: "shipped",
  refund_processed: "refund",
  order_refund: "refund",
  payout_sent: "payout",
  payout_failed: "payout",
  drop: "drop_reminder",
  reminder: "drop_reminder",
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

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")

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
  const footer = opts.unsubscribeUrl ? `You're getting this because of your Yard notification settings. Unsubscribe: ${opts.unsubscribeUrl}` : "This is a service email about your Yard account."
  const text = [b.heading, "", ...b.paragraphs.flatMap((p) => [p, ""]), ...(action ? [`${action.label}: ${action.url}`, ""] : []), "—", footer].join("\n")
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f6f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;padding:32px">
<tr><td style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#666;padding-bottom:16px">Yard</td></tr>
<tr><td style="font-size:22px;font-weight:600;padding-bottom:16px">${esc(b.heading)}</td></tr>
${b.paragraphs.map((p) => `<tr><td style="font-size:15px;line-height:1.5;padding-bottom:12px">${esc(p)}</td></tr>`).join("\n")}
${action ? `<tr><td style="padding:12px 0 20px"><a href="${esc(action.url!)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:15px">${esc(action.label)}</a></td></tr>` : ""}
<tr><td style="font-size:12px;color:#888;border-top:1px solid #eee;padding-top:16px">${opts.unsubscribeUrl ? `You're getting this because of your Yard notification settings. <a href="${esc(opts.unsubscribeUrl)}" style="color:#888">Unsubscribe</a>` : "This is a service email about your Yard account."}</td></tr>
</table></td></tr></table></body></html>`
  return { subject: b.subject, text, html, category: t.category }
}

export function templateCategory(key: EmailTemplateKey): EmailCategory {
  return (templates[key] as Template).category
}
