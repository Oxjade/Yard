"use client"

import Image from "next/image"
import { brandHref } from "@/lib/api/catalog-products"
import Link from "next/link"
import { brandById } from "@/lib/data/brands"
import { productStock } from "@/lib/data/products"
import { cn } from "@/lib/utils"
import type { Product } from "@/lib/data/types"
import { Price } from "./price"
import { ProductBadge, primaryBadge } from "./product-badge"
import { QuickAdd, type AddBlocked } from "./quick-add"
import { SponsoredTag } from "./sponsored-tag"
import { WishlistButton } from "./wishlist-button"

type Variant = "default" | "feature" | "compact" | "tall"

const ratio: Record<Variant, string> = {
  default: "aspect-[4/5]",
  tall: "aspect-[3/4.4]",
  feature: "aspect-[4/5] md:aspect-auto md:h-full md:min-h-[560px]",
  compact: "aspect-square",
}

/**
 * The product card. Photography leads; text sits quietly underneath — except the
 * `feature` variant, which puts the name over the image in display type.
 */
export function ProductCard({
  product,
  variant = "default",
  sponsored = false,
  priority = false,
  sizes = "(min-width: 1280px) 22vw, (min-width: 768px) 30vw, 50vw",
  className,
  addBlocked,
}: {
  product: Product
  variant?: Variant
  sponsored?: boolean
  priority?: boolean
  sizes?: string
  className?: string
  /**
   * Adding is closed for now; quick add stays focusable and explains why. Unset, a piece released
   * in a drop follows the drop's rules by itself (see QuickAdd); `false` means the caller has
   * applied them and adding is open.
   */
  addBlocked?: AddBlocked | false
}) {
  const brand = brandById.get(product.brandId) ?? product.brandSummary ?? { name: "Your brand", handle: "" }
  const badge = primaryBadge(product)
  const soldOut = productStock(product) === 0
  const href = `/products/${product.slug}`
  const isFeature = variant === "feature"

  return (
    <article className={cn("group/card relative flex flex-col", isFeature && "h-full", className)}>
      <div className={cn("relative overflow-hidden rounded-lg bg-card", ratio[variant], isFeature && "flex-1")}>
        <Link href={href} className="absolute inset-0 z-0 block focus-visible:outline-offset-[-2px]" aria-label={`${product.name} by ${brand.name}`}>
          <Image
            src={product.images[0].src}
            alt={product.images[0].alt}
            fill
            preload={priority}
            sizes={isFeature ? "(min-width: 768px) 50vw, 100vw" : sizes}
            className={cn(
              "object-cover transition-[transform,filter] duration-[900ms] ease-out-quint group-hover/card:scale-[1.045]",
              soldOut && "grayscale-[0.6]",
            )}
          />
          {product.images[1] && !isFeature && variant !== "compact" ? (
            <Image
              src={product.images[1].src}
              alt=""
              fill
              sizes={sizes}
              className="object-cover opacity-0 transition-opacity duration-500 ease-out-quint group-hover/card:opacity-100"
            />
          ) : null}
          {isFeature ? <span className="scrim-b absolute inset-0" aria-hidden /> : null}
        </Link>

        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-3">
          {/* The paid-placement disclosure sits with the badges, where the quick-add capsule
              (bottom right) can never cover it; on a narrow card it wraps under the badge. */}
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {soldOut ? <span className="glass inline-flex h-6 items-center rounded-[5px] px-2 text-[11px] text-ink-2">Sold out</span> : badge ? <ProductBadge kind={badge} /> : null}
            {sponsored ? <SponsoredTag /> : null}
          </div>
          <div className="pointer-events-auto">
            <WishlistButton productId={product.id} name={product.name} />
          </div>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-3 p-3">
          <div className="min-w-0">
            {isFeature ? (
              <div className="pointer-events-auto max-w-[90%]">
                <p className="text-sm text-ink-2">{brand.name}</p>
                <Link href={href} className="mt-1 block font-display text-display-md text-ink">
                  {product.name}
                </Link>
                <Price amount={product.price} currency={product.currency} compareAt={product.compareAt} size="md" className="mt-2" />
              </div>
            ) : null}
          </div>
          {variant !== "compact" ? (
            // The "+" keeps a fixed 40px slot: quick add widens into its capsule over the
            // photograph, so nothing beside or below it ever moves. On wider screens with a mouse
            // it rises in on hover or focus (and stays while its picker is open or it confirms an
            // add); on phones and touch screens it is always there.
            <div className="pointer-events-auto relative size-10 shrink-0 transition-[opacity,transform] duration-300 ease-out-quint md:pointer-fine:translate-y-1 md:pointer-fine:opacity-0 md:pointer-fine:group-hover/card:translate-y-0 md:pointer-fine:group-hover/card:opacity-100 md:pointer-fine:group-focus-within/card:translate-y-0 md:pointer-fine:group-focus-within/card:opacity-100 md:pointer-fine:has-data-expanded:translate-y-0 md:pointer-fine:has-data-expanded:opacity-100">
              <QuickAdd product={product} addBlocked={addBlocked} />
            </div>
          ) : null}
        </div>
      </div>

      {!isFeature ? (
        <div className={cn("flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3", variant === "compact" ? "mt-[21px] lg:mt-2" : "mt-[21px] lg:mt-3")}>
          {/* Below lg (touch), the brand and name lines each get a 40px tap area from an invisible
              extension that never covers the photograph or the other line: the brand's reaches 20px
              up into the gap under the photograph (21px there; the spare pixel keeps sub-pixel
              rounding from handing the photo's last row to the brand) and the 4px down to the
              name; the name's runs down over the price, which isn't a link. The extra room exists
              below lg only; from lg the card keeps its tight desktop rhythm. */}
          <div className="min-w-0">
            {brand.handle ? (
              <Link
                href={brandHref(brand.handle)}
                className="relative z-10 block text-xs text-ink-2 transition-colors after:absolute after:inset-x-0 after:-top-5 after:-bottom-1 hover:text-violet lg:after:hidden"
              >
                <span className="block truncate">{brand.name}</span>
              </Link>
            ) : (
              <span className="block truncate text-xs text-ink-2">{brand.name}</span>
            )}
            <Link href={href} className="relative mt-1 block text-sm text-ink after:absolute after:inset-x-0 after:top-0 after:-bottom-5 lg:mt-0.5 lg:after:hidden">
              <span className="block truncate">{product.name}</span>
            </Link>
          </div>
          <Price amount={product.price} currency={product.currency} compareAt={product.compareAt} className="sm:pt-5 lg:pt-[1.125rem]" />
        </div>
      ) : null}
    </article>
  )
}
