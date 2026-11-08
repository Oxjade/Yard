import Link from "next/link"
import { site } from "@/config/site"
import { LocaleSelect } from "./locale-select"
import { wordmarkType } from "./wordmark-type"

const columns = [
  { title: "Shop", links: [["Discover", "/"], ["Brands", "/brands"], ["Charts", "/charts"], ["Around", "/around"], ["All products", "/shop"], ["Categories", "/categories"], ["Drops", "/drops"], ["Stories", "/stories"]] },
  { title: "You", links: [["Your World", "/you"], ["Inbox", "/inbox"], ["Following", "/following"], ["Wishlist", "/wishlist"], ["Orders", "/you/orders"], ["Settings", "/you/settings"]] },
  { title: "For brands", links: [["Sell on " + site.name, "/studio/onboarding"], ["Brand Studio", "/studio"], ["Advertising", "/studio/advertising"]] },
] as const

export function MarketFooter() {
  return (
    <footer className="mt-24 border-t border-line-soft pb-32 lg:pb-10 print:hidden">
      <div className="mx-auto max-w-page px-4 pt-14 md:px-8">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div className="max-w-sm">
            <p className={`${wordmarkType} text-[22px]`}>{site.name}</p>
            <p className="mt-4 text-sm leading-relaxed text-ink-2">{site.description}</p>
            <p className="mt-4 text-sm leading-relaxed text-ink-2">
              Brands join free and keep their storefront free. We take {Math.round(site.commissionRate * 100)}% when a sale completes — nothing before.
            </p>
          </div>
          {columns.map((col) => (
            <div key={col.title}>
              <h2 className="text-sm text-ink">{col.title}</h2>
              <ul className="mt-2 grid md:mt-4 md:gap-2.5">
                {col.links.map(([label, href]) => (
                  <li key={href}>
                    {/* 40px tall on phones (a tap target), the quiet list from md. */}
                    <Link href={href} className="inline-flex min-h-10 items-center text-sm text-ink-2 transition-colors hover:text-ink md:min-h-0">{label}</Link>
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
