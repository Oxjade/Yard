import Link from "next/link"
import { EyeIcon, StorefrontIcon } from "@phosphor-icons/react/ssr"
import { Button } from "@/components/ui/button"
import { BrandMark } from "@/components/market/brand-mark"
import { FollowButton } from "@/components/market/follow-button"
import { FoundingBadge } from "@/components/market/founding-badge"
import { SHOP_SETUP_HREF } from "@/lib/listing-guide"
import { memberPreviewLine, opensSoonBrandLine, opensSoonPieceLine, opensSoonTitle } from "@/lib/page-visibility"

type OpensSoonBrandView = { id: string; name: string; logoSrc: string | null }

const monogram = (name: string) => ({ text: name.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2).toUpperCase() || "Y", style: "condensed" as const })

/**
 * The page a shopper gets for a product or storefront of a founding brand that hasn't published
 * its shop yet (src/lib/page-visibility.ts "opens-soon"): who the brand is and a Follow button,
 * never the piece's photos, price or details. Kept out of search (proxy X-Robots-Tag and the
 * page's robots metadata).
 */
export function OpensSoonCard({ brand, kind }: { brand: OpensSoonBrandView; kind: "product" | "brand" }) {
  return (
    <section aria-labelledby="opens-soon-title" className="mx-auto flex max-w-xl flex-col items-center rounded-2xl border border-white/[0.08] bg-white/[0.025] px-5 py-10 text-center md:px-10 md:py-14">
      <BrandMark brand={{ name: brand.name, mark: monogram(brand.name), logoSrc: brand.logoSrc }} size="xl" />
      <FoundingBadge className="mt-5" />
      <h1 id="opens-soon-title" className="mt-4 text-[1.75rem] leading-tight font-medium tracking-tight text-balance text-ink md:text-[2.25rem]">
        {opensSoonTitle(brand.name)}
      </h1>
      <p className="mt-3 max-w-sm text-[15px] text-pretty text-ink-2">{kind === "product" ? opensSoonPieceLine : opensSoonBrandLine}</p>
      <div className="mt-7 flex w-full max-w-xs flex-col items-stretch gap-2">
        <FollowButton brandId={brand.id} brandName={brand.name} size="lg" className="h-12 w-full rounded-xl text-[15px]" />
        <p className="text-xs text-ink-3">Follow and we&apos;ll let you know when {brand.name} opens.</p>
      </div>
      <Link href="/brands" className="mt-6 inline-flex min-h-10 items-center text-[13px] text-ink-2 underline-offset-4 hover:text-ink hover:underline">
        Browse brands that are open now
      </Link>
    </section>
  )
}

/**
 * The brand's own members (a Studio session acting for this brand) see this above the preview:
 * shoppers can't see the page yet, and the one tap that fixes it.
 */
export function MemberPreviewBanner({ what }: { what: string }) {
  return (
    <div role="status" className="mx-auto mb-8 flex max-w-page flex-col gap-4 rounded-2xl border border-acid/40 bg-acid/[0.07] p-4 md:flex-row md:items-center md:justify-between md:p-5">
      <p className="flex items-start gap-3 text-[15px] text-pretty text-ink">
        <EyeIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-acid" />
        <span>{memberPreviewLine(what)}</span>
      </p>
      <Button asChild variant="primary" size="lg" className="h-12 shrink-0 rounded-xl px-5 text-[15px]">
        <Link href={SHOP_SETUP_HREF}>
          <StorefrontIcon aria-hidden /> Publish my shop
        </Link>
      </Button>
    </div>
  )
}

/** The whole opens-soon page body, with the member banner on top when the viewer runs the brand. */
export function OpensSoonPage({ brand, kind, member, productTitle }: { brand: OpensSoonBrandView; kind: "product" | "brand"; member: boolean; productTitle?: string }) {
  return (
    <div className="mx-auto max-w-page px-4 pt-28 pb-24 md:px-8 md:pt-32">
      {member ? (
        <>
          <MemberPreviewBanner what={kind === "product" && productTitle ? productTitle : brand.name} />
          <p className="mb-4 text-center text-xs tracking-wide text-ink-3 uppercase">What shoppers see right now</p>
        </>
      ) : null}
      <OpensSoonCard brand={brand} kind={kind} />
    </div>
  )
}
