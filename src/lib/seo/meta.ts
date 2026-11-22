import { plainText } from "./url"

/** Search engines show about 155 characters of a meta description; Bing flags longer ones. */
export const META_DESCRIPTION_MAX = 155

/**
 * The meta description for a page: the first candidate with any text, as one plain line cut at a
 * word boundary to 155 characters. A page whose own text is empty (a product or brand with no
 * description yet) always passes a fallback written from its facts, so no indexable page ends up
 * without a description: an empty string would drop the tag rather than inherit the site default.
 */
export function metaDescription(...candidates: (string | null | undefined)[]): string {
  for (const c of candidates) {
    const t = plainText(c, META_DESCRIPTION_MAX)
    if (t) return t
  }
  return ""
}

/**
 * Pages that are private to a signed-in person or to Yard staff, or that only make sense inside a
 * flow (sign-in, checkout, email links). robots.txt disallows them, and every response under them
 * carries `X-Robots-Tag: noindex, nofollow` (next.config.ts), so a crawler that reaches one through
 * a link never indexes it. Each entry matches the path itself and everything under it.
 */
export const PRIVATE_PAGE_PREFIXES = [
  "/admin",
  "/studio",
  "/auth",
  "/you",
  "/bag",
  "/checkout",
  "/inbox",
  "/notifications",
  "/wishlist",
  "/following",
  "/welcome",
  "/unsubscribe",
  "/sign-in",
  "/dev",
] as const

/** Whether a pathname is one of the private pages above (a whole segment, so /youth is public). */
export function isPrivatePage(pathname: string): boolean {
  return PRIVATE_PAGE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}
