import { DISPOSABLE_DOMAINS } from "./disposable-domains.data"

/**
 * Which email addresses may open an account, change to, or apply to sell with (sign-up, email
 * change, brand application). No server-only import, so `tsx --test` can load it.
 *
 *  - Throwaway inboxes: the community-maintained disposable list (disposable-domains.data.ts,
 *    refreshed by `npm run email:disposable-update`), plus EXTRA_BLOCKED and a few name patterns
 *    for the mailinator-style services that rotate domains. A subdomain of a listed domain counts.
 *  - Reserved and test domains (RFC 2606 / 6761): example.com/.net/.org, *.test, *.example,
 *    *.invalid, *.localhost, localhost, and any address without a dotted domain.
 *
 * `canonicalEmail` is for duplicate detection only (never for sending): lowercase, trimmed, the
 * +tag dropped, and for Gmail the dots in the name dropped and googlemail.com read as gmail.com,
 * so a.b+shop@gmail.com and ab@gmail.com are one person.
 */

export const DISPOSABLE_EMAIL_MESSAGE = "Use an email address you'll keep. Temporary, disposable or test addresses can't be used on Yard."

/** Throwaway services the upstream list may miss (or that rotate their domains). */
const EXTRA_BLOCKED = ["mailinator.com", "mailinator.net", "mailinator2.com", "guerrillamail.com", "10minutemail.com", "yopmail.com", "temp-mail.org", "tempmail.com", "throwawaymail.com", "trashmail.com", "sharklasers.com", "getnada.com", "maildrop.cc", "dispostable.com", "fakeinbox.com", "mailnesia.com", "mohmal.com", "emailondeck.com", "burnermail.io"]

/** Name fragments of mailinator-style services; matched against the domain's labels, not the whole address. */
const BLOCKED_FRAGMENTS = ["mailinator", "guerrillamail", "10minutemail", "tempmail", "temp-mail", "throwawaymail", "trashmail", "yopmail", "fakeinbox", "disposablemail", "spamgourmet", "mailcatch", "burnermail"]

const RESERVED_DOMAINS = new Set(["example.com", "example.net", "example.org", "localhost", "localdomain", "invalid", "test", "example"])
const RESERVED_TLDS = new Set(["test", "example", "invalid", "localhost", "local", "internal"])

let blocked: Set<string> | null = null
function blockedDomains() {
  if (!blocked) {
    blocked = new Set(EXTRA_BLOCKED)
    for (const line of DISPOSABLE_DOMAINS.split("\n")) if (line) blocked.add(line)
  }
  return blocked
}

/** The address's domain, lowercased (no trailing dot), or "" when there is none. */
export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@")
  return at < 0 ? "" : email.slice(at + 1).trim().toLowerCase().replace(/\.+$/, "")
}

/** One person's address however it was typed (duplicate detection only). */
export function canonicalEmail(email: string): string {
  const e = email.trim().toLowerCase()
  const at = e.lastIndexOf("@")
  if (at < 1) return e
  let local = e.slice(0, at)
  let domain = e.slice(at + 1).replace(/\.+$/, "")
  const plus = local.indexOf("+")
  if (plus > 0) local = local.slice(0, plus)
  if (domain === "googlemail.com") domain = "gmail.com"
  if (domain === "gmail.com") local = local.replace(/\./g, "")
  return `${local}@${domain}`
}

/** Why the address can't be used (a throwaway or reserved domain), or null when it can. */
export function emailDomainProblem(email: string): string | null {
  const domain = emailDomain(email)
  // No dotted domain (localhost, an intranet name) or a reserved one.
  if (!domain || !domain.includes(".") || RESERVED_DOMAINS.has(domain)) return DISPOSABLE_EMAIL_MESSAGE
  const labels = domain.split(".")
  if (RESERVED_TLDS.has(labels[labels.length - 1])) return DISPOSABLE_EMAIL_MESSAGE
  const list = blockedDomains()
  // The domain itself or any parent (x.mailinator.com), never the bare TLD.
  for (let i = 0; i < labels.length - 1; i++) {
    const d = labels.slice(i).join(".")
    if (list.has(d) || RESERVED_DOMAINS.has(d)) return DISPOSABLE_EMAIL_MESSAGE
  }
  if (labels.some((l) => BLOCKED_FRAGMENTS.some((f) => l.includes(f)))) return DISPOSABLE_EMAIL_MESSAGE
  return null
}

/** True for an address that slipped past the list but looks throwaway (Admin › Brands "Risky"). */
export function emailLooksThrowaway(email: string): boolean {
  const domain = emailDomain(email)
  if (emailDomainProblem(email)) return true
  // A label starting with a throwaway word (tempbox-mail.net), or a name full of digits (mail20240101.com).
  return /(^|[.-])(temp|tmp|trash|spam|fake|burner|throwaway|disposable|junk)/.test(domain) || /\d{4,}/.test(domain.split(".")[0] ?? "")
}
