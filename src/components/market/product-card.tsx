"use client"

import Image from "next/image"
import Link from "next/link"
import { brandById } from "@/lib/data/brands"
import { productStock } from "@/lib/data/products"
import { cn } from "@/lib/utils"
import type { Product } from "@/lib/data/types"
import { Price } from "./price"
import { ProductBadge, primaryBadge } from "./product-badge"
import { QuickAdd } from "./quick-add"
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
}: {
  product: Product
  variant?: Variant
  sponsored?: boolean
  priority?: boolean
  sizes?: string
  className?: string
}) {
  const brand = brandById.get(product.brandId) ?? { name: "Your brand", handle: "" }
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
            priority={priority}
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

        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between p-3">
          <div className="flex gap-1.5">
            {soldOut ? <span className="glass inline-flex h-6 items-center rounded-[5px] px-2 text-[11px] text-ink-2">Sold out</span> : badge ? <ProductBadge kind={badge} /> : null}
          </div>
          <div className="pointer-events-auto">
            <WishlistButton productId={product.id} name={product.name} />
          </div>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-3 p-3">
          <div className="min-w-0">
            {sponsored ? <SponsoredTag className="mb-2" /> : null}
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
            <div className="pointer-events-auto translate-y-1 opacity-100 transition-[opacity,transform] duration-300 ease-out-quint md:opacity-0 md:group-hover/card:translate-y-0 md:group-hover/card:opacity-100 md:group-focus-within/card:translate-y-0 md:group-focus-within/card:opacity-100">
              <QuickAdd product={product} />
            </div>
          ) : null}
        </div>
      </div>

      {!isFeature ? (
        <div className={cn("flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3", variant === "compact" ? "mt-2" : "mt-3")}>
          <div className="min-w-0">
            {brand.handle ? (
              <Link href={`/brands/${brand.handle}`} className="relative z-10 block truncate text-xs text-ink-2 transition-colors hover:text-violet">
                {brand.name}
              </Link>
            ) : (
              <span className="block truncate text-xs text-ink-2">{brand.name}</span>
            )}
            <Link href={href} className="mt-0.5 block truncate text-sm text-ink">
              {product.name}
            </Link>
          </div>
          <Price amount={product.price} currency={product.currency} compareAt={product.compareAt} className="sm:pt-[1.125rem]" />
        </div>
      ) : null}
    </article>
  )
}
