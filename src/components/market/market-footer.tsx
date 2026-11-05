import Link from "next/link"
import { site } from "@/config/site"
import { LocaleSelect } from "./locale-select"

const columns = [
  { title: "Shop", links: [["Discover", "/"], ["Brands", "/brands"], ["All products", "/shop"], ["Categories", "/categories"], ["Drops", "/drops"], ["Stories", "/stories"]] },
  { title: "You", links: [["Your World", "/you"], ["Following", "/following"], ["Wishlist", "/wishlist"], ["Orders", "/you/orders"], ["Settings", "/you/settings"]] },
  { title: "For brands", links: [["Sell on " + site.name, "/studio/onboarding"], ["Brand Studio", "/studio"], ["Advertising", "/studio/advertising"]] },
] as const

export function MarketFooter() {
  return (
    <footer className="mt-24 border-t border-line-soft pb-28 lg:pb-10">
      <div className="mx-auto max-w-page px-4 pt-14 md:px-8">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div className="max-w-sm">
            <p className="font-wide chrome-text text-lg tracking-[0.14em]">{site.name}</p>
            <p className="mt-4 text-sm leading-relaxed text-ink-2">{site.description}</p>
            <p className="mt-4 text-sm leading-relaxed text-ink-2">
              Brands join free and keep their storefront free. We take {Math.round(site.commissionRate * 100)}% when a sale completes — nothing before.
            </p>
          </div>
          {columns.map((col) => (
            <div key={col.title}>
              <h2 className="text-sm text-ink">{col.title}</h2>
              <ul className="mt-4 grid gap-2.5">
                {col.links.map(([label, href]) => (
                  <li key={href}>
                    <Link href={href} className="text-sm text-ink-2 transition-colors hover:text-ink">{label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-14 flex flex-col gap-4 border-t border-line-soft pt-6 md:flex-row md:items-center md:justify-between">
          <LocaleSelect />
          <p className="text-xs text-ink-3">© 2026 {site.name}. Development build with sample data and placeholder photography.</p>
        </div>
      </div>
    </footer>
  )
}
