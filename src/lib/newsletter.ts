/**
 * Admin › Newsletter: the rules and words shared by the composer, the email template
 * (src/server/email/templates.ts, `newsletter` and `service_notice`), the server and `tsx --test`.
 * Pure: no "server-only", no database.
 *
 * The admin writes the words. The body is a small Markdown: blank lines separate paragraphs,
 * `**bold**`, `[label](url)`, and lines that start with "- " (or "* ") make a bullet list. A single
 * line break inside a paragraph is kept. Nothing else is interpreted (no HTML, no headings), so what
 * the admin types is what the email shows.
 */
import type { NEWSLETTER_AUDIENCES, NEWSLETTER_KINDS, NEWSLETTER_RECIPIENT_STATUSES, NEWSLETTER_STATUSES } from "./api/contracts/enums"

export type NewsletterKind = (typeof NEWSLETTER_KINDS)[number]
export type NewsletterStatus = (typeof NEWSLETTER_STATUSES)[number]
export type NewsletterAudienceType = (typeof NEWSLETTER_AUDIENCES)[number]
export type NewsletterRecipientStatus = (typeof NEWSLETTER_RECIPIENT_STATUSES)[number]

export type NewsletterAudience = { type: "shoppers" } | { type: "brands" } | { type: "followers"; brandId: string } | { type: "country"; country: string }

/* ---------- Limits ---------- */

export const NEWSLETTER_LIMITS = {
  name: 80,
  subject: 120,
  preheader: 140,
  heading: 80,
  body: 8000,
  heroAlt: 160,
  buttonLabel: 40,
  buttonUrl: 500,
} as const

/** Recipients handed to the email outbox per minute (the job's batch), unless YARD_NEWSLETTER_PER_MINUTE says otherwise. */
export const NEWSLETTER_PER_MINUTE = 100
/** The job stops feeding the outbox while this many campaign emails are still waiting there (backpressure). */
export const NEWSLETTER_OUTBOX_HIGH_WATER = 300
/** The earliest a campaign can be scheduled: a few minutes out, so "later" is never "now". */
export const NEWSLETTER_MIN_LEAD_MS = 5 * 60_000
/** And the latest: 60 days out. */
export const NEWSLETTER_MAX_LEAD_MS = 60 * 24 * 3600_000
/** Test sends per admin per hour. */
export const NEWSLETTER_TESTS_PER_HOUR = 10

/* ---------- Words ---------- */

export const newsletterKindMeta: Record<NewsletterKind, { label: string; short: string; body: string; why: string; eyebrow: string }> = {
  marketing: {
    label: "Marketing",
    short: "Marketing",
    body: "Drops, picks, offers and news. Only people who said yes to news and offers from Yard get it, and every email has a one-click unsubscribe.",
    why: "You're getting this because you said yes to news and offers from Yard.",
    eyebrow: "News from Yard",
  },
  service: {
    label: "Service notice",
    short: "Service",
    body: "Changes to our terms, privacy policy or how Yard works. It goes to everyone, opted in or not, so it's not for promotions, offers or drops.",
    why: "You're getting this service notice because you have a Yard account. We only send these for important changes to Yard, even when marketing emails are off.",
    eyebrow: "Service notice",
  },
}

export const newsletterAudienceMeta: Record<NewsletterAudienceType, { label: string; body: string }> = {
  shoppers: { label: "All shoppers", body: "Everyone with a shopper account." },
  brands: { label: "All brands", body: "The owners and admins of every brand on Yard." },
  followers: { label: "Followers of a brand", body: "Shoppers who follow one brand you choose." },
  country: { label: "Shoppers in a country", body: "Shoppers whose account says they're in one country." },
}

/** Tones are the Admin StatusBadge's: purple = in progress, ink edge = needs a look. */
export const newsletterStatusMeta: Record<NewsletterStatus, { label: string; tone: "muted" | "attention" | "info" | "success" | "danger" }> = {
  draft: { label: "Draft", tone: "muted" },
  scheduled: { label: "Scheduled", tone: "attention" },
  sending: { label: "Sending", tone: "info" },
  sent: { label: "Sent", tone: "success" },
  cancelled: { label: "Stopped", tone: "danger" },
}

export const newsletterRecipientStatusLabels: Record<NewsletterRecipientStatus, string> = {
  pending: "Waiting",
  queued: "In the outbox",
  sent: "Sent",
  failed: "Failed",
  suppressed: "Skipped (unsubscribed or bounced)",
  stub: "Not sent (no email provider)",
  cancelled: "Cancelled",
}

/** Placeholders in the composer: Yard's voice, so a blank field still shows what good looks like. The admin writes the real words. */
export const newsletterHints = {
  name: "e.g. November drops roundup",
  subject: "The heat just landed 🔥",
  preheader: "Fresh drops from Lagos, Accra and London. Tap in before they're gone.",
  heading: "Fresh in the Yard",
  body: "Hey, it's been a minute! Here's what's moving on Yard this week.\n\n- **New drops** from brands you'll love\n- Restocks on the pieces everyone asked about\n\nTap in, save what you like and [shop the latest](/shop).",
  buttonLabel: "Shop the drops",
  buttonUrl: "/shop",
  heroAlt: "What's in the picture, for people who can't see it",
} as const

export const NEWSLETTER_DEFAULT_NAME = "Untitled campaign"

/** "Hey Ada," from a full name (first word), or null. */
export function newsletterGreeting(name: string | null | undefined): string | null {
  const first = String(name ?? "").trim().split(/\s+/)[0]
  return first ? `Hey ${first},` : null
}

/* ---------- Links ---------- */

/**
 * A link the newsletter may carry: a Yard path ("/shop") becomes absolute on Yard's origin;
 * an absolute https URL is kept (admins link Instagram, a lookbook…); http is allowed only on
 * Yard's own origin (local development). Anything else (javascript:, mailto:, data:, relative
 * paths without "/") is refused.
 */
export function newsletterLink(url: string, origin: string): string | null {
  const raw = String(url ?? "").trim()
  if (!raw || raw.length > NEWSLETTER_LIMITS.buttonUrl || /[\s<>"]/.test(raw)) return null
  if (raw.startsWith("/") && !raw.startsWith("//")) return `${origin}${raw}`
  try {
    const u = new URL(raw)
    if (u.username || u.password) return null
    if (u.protocol === "https:") return u.toString()
    if (u.protocol === "http:" && u.origin === origin) return u.toString()
    return null
  } catch {
    return null
  }
}

/* ---------- Body (small Markdown) ---------- */

export type NewsletterRun = { text: string; bold?: boolean; href?: string }
export type NewsletterBlock = { kind: "p"; runs: NewsletterRun[] } | { kind: "ul"; items: NewsletterRun[][] }

const INLINE = /\*\*([^*\n](?:[^*]*?[^*\n])?)\*\*|\[([^\]\n]{1,200})\]\(([^)\s]{1,500})\)/g

/** Inline runs of one line or paragraph. Links are resolved with `link`; one that fails keeps its label as plain text and is reported in `bad`. */
function inline(text: string, link: (url: string) => string | null, bad: string[]): NewsletterRun[] {
  const runs: NewsletterRun[] = []
  let last = 0
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index) })
    if (m[1] !== undefined) runs.push({ text: m[1], bold: true })
    else {
      const href = link(m[3])
      if (href) runs.push({ text: m[2], href })
      else {
        bad.push(m[3])
        runs.push({ text: m[2] })
      }
    }
    last = m.index + m[0].length
  }
  if (last < text.length) runs.push({ text: text.slice(last) })
  // Merge neighbouring plain runs (keeps the output small and the tests readable).
  const out: NewsletterRun[] = []
  for (const r of runs) {
    const prev = out[out.length - 1]
    if (prev && !prev.bold && !prev.href && !r.bold && !r.href) prev.text += r.text
    else if (r.text) out.push({ ...r })
  }
  return out
}

const BULLET = /^\s*[-*•]\s+/

/**
 * Parses the body into blocks. `origin` resolves Yard paths in links. Returns the blocks and the
 * links that couldn't be used (the composer shows them; the server refuses to save them for sending).
 */
export function parseNewsletterBody(body: string, origin: string): { blocks: NewsletterBlock[]; badLinks: string[] } {
  const bad: string[] = []
  const link = (url: string) => newsletterLink(url, origin)
  const blocks: NewsletterBlock[] = []
  const text = String(body ?? "").replace(/\r\n?/g, "\n").slice(0, NEWSLETTER_LIMITS.body)
  for (const chunk of text.split(/\n\s*\n/)) {
    const lines = chunk.split("\n").filter((l) => l.trim())
    if (!lines.length) continue
    // A chunk may mix a lead-in line and bullets: consecutive bullets form one list, other lines a paragraph.
    let para: string[] = []
    let items: string[] = []
    const flushPara = () => {
      if (para.length) blocks.push({ kind: "p", runs: inline(para.map((l) => l.trim()).join("\n"), link, bad) })
      para = []
    }
    const flushList = () => {
      if (items.length) blocks.push({ kind: "ul", items: items.map((i) => inline(i, link, bad)) })
      items = []
    }
    for (const l of lines) {
      if (BULLET.test(l)) {
        flushPara()
        items.push(l.replace(BULLET, "").trim())
      } else {
        flushList()
        para.push(l)
      }
    }
    flushPara()
    flushList()
  }
  return { blocks: blocks.slice(0, 60), badLinks: [...new Set(bad)] }
}

/** The body as plain text (the email's text part): bullets as "• ", links as "label (url)". */
export function newsletterBlocksText(blocks: NewsletterBlock[]): string[] {
  const runText = (runs: NewsletterRun[]) => runs.map((r) => (r.href ? `${r.text} (${r.href})` : r.text)).join("")
  return blocks.map((b) => (b.kind === "p" ? runText(b.runs) : b.items.map((i) => `• ${runText(i)}`).join("\n")))
}

/* ---------- Readiness ---------- */

export type NewsletterContent = {
  kind: NewsletterKind
  subject: string
  preheader: string
  heading: string
  body: string
  heroMediaId: string | null
  heroAlt: string
  buttonLabel: string
  buttonUrl: string
  audience: NewsletterAudience
}

/**
 * What still stops a draft from being sent, as { field: message }. Empty when it's ready. The same
 * check runs in the composer (to point at the field) and on the server (Send, test send).
 */
export function newsletterProblems(c: NewsletterContent, origin: string): Record<string, string> {
  const p: Record<string, string> = {}
  if (c.subject.trim().length < 3) p.subject = "Give it a subject line."
  if (c.heading.trim().length < 2) p.heading = "Add a heading: it's the big line at the top."
  if (c.body.trim().length < 10) p.body = "Write the message first: at least 10 characters."
  else {
    const { badLinks } = parseNewsletterBody(c.body, origin)
    if (badLinks.length) p.body = `This link can't be used: ${badLinks[0].slice(0, 60)}. Use a Yard path like /shop or a full https:// address.`
  }
  const label = c.buttonLabel.trim()
  const url = c.buttonUrl.trim()
  if (label && !url) p.buttonUrl = "Add where the button goes."
  else if (url && !label) p.buttonLabel = "Give the button a label."
  else if (url && !newsletterLink(url, origin)) p.buttonUrl = "Use a Yard path like /shop or a full https:// address."
  if (c.heroMediaId && !c.heroAlt.trim()) p.heroAlt = "Describe the image for people who can't see it."
  if (c.audience.type === "followers" && !c.audience.brandId) p.audience = "Choose the brand whose followers get it."
  if (c.audience.type === "country" && !/^[A-Z]{2}$/.test(c.audience.country ?? "")) p.audience = "Choose the country."
  return p
}

/** A marketing-sounding service notice: words that belong in a Marketing campaign. Only a warning in the composer. */
export function soundsPromotional(c: Pick<NewsletterContent, "subject" | "heading" | "body">): boolean {
  return /\b(sale|discount|% off|promo|coupon|deal|offer|free shipping|drop(s)?\b|limited time|shop now)/i.test(`${c.subject}\n${c.heading}\n${c.body}`)
}
