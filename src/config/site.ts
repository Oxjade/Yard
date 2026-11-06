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
  commissionRate: 0.05,
} as const

export type NavItem = { href: string; label: string }

export const marketNav: NavItem[] = [
  { href: "/", label: "Discover" },
  { href: "/brands", label: "Brands" },
  { href: "/shop", label: "Shop" },
  { href: "/categories", label: "Categories" },
  { href: "/drops", label: "Drops" },
  { href: "/following", label: "Following" },
]
