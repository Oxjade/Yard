/**
 * The platform's name and global copy. The product is called Yard: copy reads `site.name`
 * ("Sign in to Yard") rather than spelling it, and wordmarks set it in capitals with CSS
 * (`uppercase`), so the name lives here alone. Storage keys, event names and ids still carry
 * the old working name ("nocturne-…") on purpose: renaming them would drop what browsers have
 * already saved.
 */
export const site = {
  name: "Yard",
  shortName: "Yard",
  tagline: "Independent brands, found first.",
  description:
    "A global destination for discovering, following and shopping independent brands.",
  /** Commission on each completed sale (3.5%). */
  commissionRate: 0.035,
  /** Launch offer: no commission on sales placed before this moment (UTC), for every brand. */
  launchFreeUntil: "2027-02-12T00:00:00Z",
} as const

export type NavItem = { href: string; label: string }

/**
 * The desktop header's links (§7.1). Shop and Categories stay in the header, as the owner asked;
 * they are also first in the search overlay's Browse row and in the footer.
 */
export const marketNav: NavItem[] = [
  { href: "/", label: "Discover" },
  { href: "/brands", label: "Brands" },
  { href: "/shop", label: "Shop" },
  { href: "/categories", label: "Categories" },
  { href: "/charts", label: "Charts" },
  { href: "/around", label: "Around" },
  { href: "/drops", label: "Drops" },
  { href: "/following", label: "Following" },
]

/**
 * The search overlay's Browse row (§7.3), in this order: what the phone home bar's Explore tab
 * opens on, so Charts and Drops are two taps from anywhere.
 */
export const browseLinks: NavItem[] = [
  { href: "/shop", label: "Shop" },
  { href: "/charts", label: "Charts" },
  { href: "/around", label: "Around" },
  { href: "/drops", label: "Drops" },
  { href: "/brands", label: "Brands" },
  { href: "/categories", label: "Categories" },
  { href: "/sell", label: "Sell on Yard" },
]
