/**
 * The shopper welcome email: who gets it and what it says. Shared by the email template
 * (src/server/email/templates.ts, `shopper_welcome`), the server (src/server/email/welcome.ts)
 * and `tsx --test`. Pure: no "server-only", no database.
 *
 * Sent once per account, right after it becomes usable: when a password sign-up confirms its
 * email (or first proves it another way), or when a Google / Apple / OAuth sign-in creates it with
 * a provider-verified email. Never to brand or team accounts, admins, demo, sample or test accounts.
 */

export const WELCOME_TEMPLATE = "shopper_welcome"
/** The outbox dedupe key: one welcome per user, whatever retries. */
export const welcomeDedupeKey = (userId: string) => `shopper_welcome:${userId}`

/** At most this many brands to follow; with fewer than WELCOME_MIN_BRANDS the section is left out. */
export const WELCOME_MAX_BRANDS = 4
export const WELCOME_MIN_BRANDS = 2

export type WelcomeBrand = { name: string; handle: string }

/**
 * Email domains reserved for documentation and testing (RFC 2606 / RFC 6761). No real person
 * reads mail there, so an account on one is a test account.
 */
const TEST_DOMAIN_RE = /(^|\.)(example\.(com|net|org)|test|example|invalid|localhost|local)$/i

/** Seeded test shoppers are `u_t_*` (src/server/db/schema/people.ts). */
export const isTestAccount = (u: { id: string; email: string }) => /^u_t_/.test(u.id) || TEST_DOMAIN_RE.test(u.email.trim().split("@").pop() ?? "")

export type WelcomeCandidate = {
  id: string
  kind: string
  email: string
  status: string
  demo: boolean
  welcomeEmailAt: Date | null
  /** The account belongs to a brand team (any brand membership, whatever its status or role). */
  brandMember: boolean
  /** The account is on the Yard admin team. */
  admin: boolean
}

/** Why an account gets no welcome, or null when it should get one. */
export function welcomeSkipReason(u: WelcomeCandidate): string | null {
  if (u.welcomeEmailAt) return "already_sent"
  if (u.demo) return "demo"
  if (u.kind !== "shopper") return u.kind === "admin" ? "admin" : "brand_account"
  if (u.admin) return "admin"
  if (u.brandMember) return "brand_account"
  if (u.status !== "active") return "not_active"
  if (isTestAccount(u)) return "test"
  return null
}

/** The `brands` var: a short JSON list the template reads defensively. */
export function encodeWelcomeBrands(list: WelcomeBrand[]): string {
  return JSON.stringify(list.slice(0, WELCOME_MAX_BRANDS).map((b) => ({ name: b.name.slice(0, 80), handle: b.handle.slice(0, 80) })))
}

/** Reads the `brands` var back; anything malformed is dropped (the email then has no brand list). */
export function decodeWelcomeBrands(raw: unknown): WelcomeBrand[] {
  if (typeof raw !== "string" || !raw || raw.length > 2000) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: WelcomeBrand[] = []
  for (const b of parsed) {
    if (!b || typeof b !== "object") continue
    const name = typeof (b as { name?: unknown }).name === "string" ? (b as { name: string }).name.trim() : ""
    const handle = typeof (b as { handle?: unknown }).handle === "string" ? (b as { handle: string }).handle.trim() : ""
    if (!name || !/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(handle)) continue
    out.push({ name: name.slice(0, 80), handle })
    if (out.length === WELCOME_MAX_BRANDS) break
  }
  return out
}

type Run = { text: string; href?: string; bold?: boolean }

export type WelcomeCopy = {
  subject: string
  preheader: string
  eyebrow: string
  heading: string
  greeting?: string
  paragraphs: string[]
  /** Paragraphs and a bullet list with links, after `paragraphs`. Every link is a Yard path; templates.ts checks it. */
  blocks: ({ kind: "p"; runs: Run[] } | { kind: "ul"; items: Run[][] })[]
  action: { label: string; url: string }
  secondary: { label: string; url: string }
  why: string
}

/** The welcome email's words. `brands`: live brands picked at send time (fewer than 2: no list). */
export function welcomeCopy(x: { name?: string; brands: WelcomeBrand[] }): WelcomeCopy {
  const first = x.name?.trim().split(/\s+/)[0]
  const brands = x.brands.slice(0, WELCOME_MAX_BRANDS)
  const list = brands.length >= WELCOME_MIN_BRANDS
  return {
    subject: "You're in. Welcome to Yard 👋",
    preheader: "Independent brands, found first. Follow the ones you like and never miss a drop.",
    eyebrow: "Welcome to Yard",
    heading: "You're in 👋",
    ...(first ? { greeting: `Hey ${first},` } : {}),
    paragraphs: [
      "Yard is where independent brands drop their pieces, and where you find them first. Small labels, real makers, nothing you'll see on everyone else.",
      "Here's the move: follow a brand and you'll hear about its drops before they're gone. No follow, no heads-up.",
    ],
    blocks: list
      ? [
          { kind: "p", runs: [{ text: "A few brands to follow", bold: true }] },
          { kind: "ul", items: brands.map((b) => [{ text: b.name, href: `/brands/${b.handle}`, bold: true }]) },
        ]
      : [],
    action: { label: "Start shopping", url: "/shop" },
    secondary: { label: "Find brands to follow", url: "/brands" },
    why: "You're getting this because you just created a Yard account. It's a one-time welcome.",
  }
}
