/**
 * Working name and global copy. The platform name is a placeholder — change it here.
 */
export const site = {
  name: "NOCTURNE",
  shortName: "NCTRN",
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
