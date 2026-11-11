import Link from "next/link"
import { ClockIcon } from "@phosphor-icons/react/ssr"
import { EmptyState } from "@/components/dashboard/empty-state"
import { PageHeader } from "@/components/dashboard/page-header"
import { Button } from "@/components/ui/button"

/**
 * Screens that only have sample data so far. In production (the demo switch off) src/proxy.ts
 * redirects their addresses to /…/coming-soon/<feature>, which renders this page state instead;
 * demo and development keep the sample screens unchanged.
 */
export const COMING_SOON = {
  studio: {
    analytics: { title: "Analytics", body: "Sales, traffic and conversion reports are on their way. Your Overview, Orders and Payouts already show your real figures.", back: { href: "/studio", label: "Back to Overview" } },
    customers: { title: "Customers", body: "A customer list with order history is on its way. Each order already shows who placed it and where it ships.", back: { href: "/studio/orders", label: "Open orders" } },
    promotions: { title: "Promotions", body: "Discount codes and sales are on their way. You'll set them up here when they launch.", back: { href: "/studio", label: "Back to Overview" } },
    advertising: { title: "Advertising", body: "Sponsored placements across Yard are on their way. You'll plan and track campaigns here when they launch.", back: { href: "/studio", label: "Back to Overview" } },
  },
  admin: {
    advertising: { title: "Advertising", body: "Campaign review opens when brands can buy sponsored placements.", back: { href: "/admin", label: "Back to Overview" } },
    health: { title: "Health", body: "Service monitoring is on its way. Payment provider events and their outcomes are on the Orders page.", back: { href: "/admin/orders", label: "Open orders" } },
  },
  market: {
    stories: { title: "Stories", body: "Stories from the brands on Yard are on their way. Until then, meet the brands themselves.", back: { href: "/brands", label: "Browse brands" } },
    collections: { title: "Collections", body: "Edits across brands are on their way. Until then, everything on Yard is in the shop.", back: { href: "/shop", label: "Browse the shop" } },
  },
} as const

export type ComingSoonSurface = keyof typeof COMING_SOON
type Entry = { title: string; body: string; back: { href: string; label: string } }

export function comingSoonEntry(surface: ComingSoonSurface, feature: string): Entry | null {
  const map = COMING_SOON[surface] as Record<string, Entry>
  return Object.hasOwn(map, feature) ? map[feature] : null
}

/** The "coming soon" page state: a page, never a modal. Workspace pages keep their header; the market one its editorial heading. */
export function ComingSoon({ surface, entry }: { surface: ComingSoonSurface; entry: Entry }) {
  const action = (
    <Button asChild variant="secondary" size="sm" className="h-10">
      <Link href={entry.back.href}>{entry.back.label}</Link>
    </Button>
  )
  if (surface === "market") {
    return (
      <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
        <h1 className="font-display text-display-lg text-ink">{entry.title}</h1>
        <EmptyState icon={ClockIcon} title="Coming soon" body={entry.body} action={action} className="mt-8 md:mt-10" />
      </div>
    )
  }
  return (
    <div>
      <PageHeader title={entry.title} />
      <EmptyState icon={ClockIcon} title="Coming soon" body={entry.body} action={action} className="mt-6" />
    </div>
  )
}
