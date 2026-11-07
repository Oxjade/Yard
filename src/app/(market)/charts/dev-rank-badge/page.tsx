import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { RankBadge } from "@/components/charts/entry/rank-badge"

export const metadata: Metadata = { title: "RankBadge (dev)", robots: { index: false, follow: false } }

const cases = [
  { brandId: "b_lagos_static", note: "Ranked brand, meta variant (storefront meta row)", variant: "meta" as const },
  { brandId: "b_lagos_static", note: "Ranked brand, stat variant (brand card)", variant: "stat" as const },
  { brandId: "b_paper_riot", note: "Held brand: renders nothing", variant: "meta" as const },
  { brandId: "b_lagos_static", note: "Storefront preview: renders nothing", variant: "meta" as const, preview: true },
]

/**
 * Development-only preview of C's RankBadge entry component, which N mounts in storefronts and
 * brand cards in wave 3. Lets the badge's states be checked in a browser before then. 404 in
 * production, like F1's /dev/components.
 */
export default function RankBadgePreviewPage() {
  if (process.env.NODE_ENV === "production") notFound()
  return (
    <div className="mx-auto max-w-page px-4 pt-28 pb-24 md:px-8 md:pt-32">
      <h1 className="text-lg text-ink">RankBadge preview</h1>
      <p className="mt-1 text-sm text-ink-2">Development only. These badges read the live /api/charts/brand endpoint.</p>
      <ul className="mt-6 grid gap-3">
        {cases.map((c, i) => (
          <li key={i} className="grid gap-2 rounded-lg border border-line-soft bg-card p-4" data-case={i}>
            <p className="text-xs text-ink-2">{c.note}</p>
            <div className="flex min-h-7 items-center gap-3 text-sm text-ink-2">
              <span>{c.brandId}</span>
              <RankBadge brandId={c.brandId} variant={c.variant} preview={c.preview} />
            </div>
          </li>
        ))}
        <li className="grid gap-2 rounded-lg border border-line-soft bg-card p-4" data-case="in-card">
          <p className="text-xs text-ink-2">Inside a brand card link: asLink=false renders text, so links never nest</p>
          <Link href="/brands/lagos-static" className="grid gap-1 rounded-md border border-line-soft p-3 text-sm text-ink hover:border-white/20">
            Lagos Static
            <RankBadge brandId="b_lagos_static" variant="stat" asLink={false} />
          </Link>
        </li>
      </ul>
    </div>
  )
}
