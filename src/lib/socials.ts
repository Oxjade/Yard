/**
 * Yard's own social profiles, from environment variables: each is a full https URL on that
 * network's own domain, or it is left out (no icon, no sameAs, no llms.txt line). Pure: no
 * imports, safe under `tsx --test` and in client bundles (it reads no env by itself in the browser;
 * the server passes the list down).
 *
 * Read at request time: the footer and the home page's JSON-LD render them inside a Suspense
 * boundary after `connection()`, so a restart is enough after changing /etc/yard.env.
 *
 * Not to be confused with YARD_SOCIAL_SANDBOX (the development stand-in for Instagram/TikTok
 * connections in Studio), which is not a profile link.
 */
type EnvLike = Record<string, string | undefined>

export type YardSocialKey = "instagram" | "tiktok" | "x" | "youtube" | "threads" | "facebook" | "snapchat" | "whatsapp" | "linkedin"

export type YardSocial = { key: YardSocialKey; label: string; href: string }

/** In display order: the four main networks first, then the optional ones. */
export const yardSocialNetworks: { key: YardSocialKey; env: string; label: string; hosts: string[] }[] = [
  { key: "instagram", env: "YARD_SOCIAL_INSTAGRAM", label: "Instagram", hosts: ["instagram.com"] },
  { key: "tiktok", env: "YARD_SOCIAL_TIKTOK", label: "TikTok", hosts: ["tiktok.com"] },
  { key: "x", env: "YARD_SOCIAL_X", label: "X", hosts: ["x.com", "twitter.com"] },
  { key: "youtube", env: "YARD_SOCIAL_YOUTUBE", label: "YouTube", hosts: ["youtube.com", "youtu.be"] },
  { key: "threads", env: "YARD_SOCIAL_THREADS", label: "Threads", hosts: ["threads.net", "threads.com"] },
  { key: "facebook", env: "YARD_SOCIAL_FACEBOOK", label: "Facebook", hosts: ["facebook.com", "fb.com"] },
  { key: "snapchat", env: "YARD_SOCIAL_SNAPCHAT", label: "Snapchat", hosts: ["snapchat.com"] },
  { key: "whatsapp", env: "YARD_SOCIAL_WHATSAPP", label: "WhatsApp", hosts: ["whatsapp.com", "wa.me"] },
  { key: "linkedin", env: "YARD_SOCIAL_LINKEDIN", label: "LinkedIn", hosts: ["linkedin.com"] },
]

export const yardSocialEnvNames = yardSocialNetworks.map((n) => n.env)

/** The URL, normalised, when it is https on one of the network's domains (or a subdomain of one); otherwise null. */
export function socialUrl(raw: string | undefined, hosts: string[]): string | null {
  const v = raw?.trim()
  if (!v) return null
  let u: URL
  try {
    u = new URL(v)
  } catch {
    return null
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null
  const host = u.hostname.toLowerCase()
  if (!hosts.some((h) => host === h || host.endsWith(`.${h}`))) return null
  return u.toString()
}

/** Every configured profile, in display order. */
export function yardSocials(env: EnvLike = process.env): YardSocial[] {
  const out: YardSocial[] = []
  for (const n of yardSocialNetworks) {
    const href = socialUrl(env[n.env], n.hosts)
    if (href) out.push({ key: n.key, label: n.label, href })
  }
  return out
}

/** Set variables that are ignored, for a boot warning and check-env. Never fatal. */
export function yardSocialWarnings(env: EnvLike = process.env): string[] {
  const out: string[] = []
  for (const n of yardSocialNetworks) {
    const v = env[n.env]?.trim()
    if (v && !socialUrl(v, n.hosts)) out.push(`${n.env} must be a full https URL on ${n.hosts.join(" or ")} (like https://${n.hosts[0]}/yard); the ${n.label} link is hidden`)
  }
  return out
}
