"use client"

import { useMemo, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { PackageIcon as PackageOpen } from "@phosphor-icons/react"
import { AnimatePresence, motion } from "motion/react"
import { BrandMark } from "@/components/market/brand-mark"
import { ShopProductCard } from "@/components/market/editorial/use-drop-add-block"
import { EmptyCard } from "@/components/market/editorial/empty-card"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { priceUsd } from "@/lib/data"
import { duration, ease } from "@/lib/motion"
import { cn } from "@/lib/utils"
import type { Brand, Collection, Product } from "@/lib/data/types"
import { usePublishedStorefront } from "./live-storefront"
import { AccentLink } from "./parts"
import { collectionHref } from "./sections/collections"
import { accentStyle, collectionsAnchorId, storefrontType } from "./theme"

type Sort = "featured" | "newest" | "price-asc" | "price-desc"

const sorts: { value: Sort; label: string }[] = [
  { value: "featured", label: "Featured" },
  { value: "newest", label: "Newest" },
  { value: "price-asc", label: "Price, low to high" },
  { value: "price-desc", label: "Price, high to low" },
]

function sortProducts(list: Product[], sort: Sort) {
  if (sort === "featured") return list // the brand's own order
  return [...list].sort((a, b) => {
    if (sort === "newest") return b.createdAt.localeCompare(a.createdAt)
    if (sort === "price-asc") return priceUsd(a) - priceUsd(b)
    return priceUsd(b) - priceUsd(a)
  })
}

/**
 * A brand collection, set in the brand's accent and headline type so it reads as part of the
 * storefront. The header follows the marketplace's other image-header pages (/collections,
 * /categories): full-bleed photograph, scrim-l and scrim-b, title at the foot.
 */
export function CollectionView({ brand: seedBrand, collection, products, others }: { brand: Brand; collection: Collection; products: Product[]; others: Collection[] }) {
  const [sort, setSort] = useState<Sort>("featured")
  const sorted = useMemo(() => sortProducts(products, sort), [products, sort])
  // Accent, headline type, mark and the breadcrumb's anchor follow the storefront the brand has
  // published (the Studio brand's lives in the Studio store), so the page matches the storefront.
  const { brand, config } = usePublishedStorefront(seedBrand)
  const type = storefrontType[config.typePreset] ?? storefrontType.condensed
  const storefront = `/brands/${brand.handle}`
  // Where the storefront lists its collections: the section, or the index under a Street hero.
  const anchor = collectionsAnchorId(config, [collection, ...others])
  const crumbs = [
    { href: storefront, label: brand.name },
    ...(anchor ? [{ href: `${storefront}#${anchor}`, label: "Collections" }] : []),
  ]

  return (
    <div style={accentStyle(config.accent)} className="@container">
      <header className="relative isolate overflow-hidden">
        <Image src={collection.image.src} alt={collection.image.alt} fill preload sizes="100vw" className="-z-10 object-cover" />
        <span aria-hidden className="scrim-l absolute inset-0 -z-10" />
        <span aria-hidden className="scrim-b absolute inset-0 -z-10" />
        <div className="mx-auto flex min-h-[520px] max-w-page flex-col px-4 pt-28 pb-8 md:min-h-[620px] md:px-8 md:pt-32 md:pb-12">
          <nav aria-label="Breadcrumb">
            <ol className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm text-ink/80 lg:gap-y-1">
              {crumbs.map((c, i) => (
                <li key={c.href} className="flex items-center gap-2">
                  {i > 0 ? (
                    <span aria-hidden className="text-ink-2">
                      /
                    </span>
                  ) : null}
                  <Link href={c.href} className="inline-flex min-h-10 items-center gap-2 rounded-sm transition-colors hover:text-(color:--sf-accent) lg:min-h-0">
                    {i === 0 ? <BrandMark brand={brand} size="xs" /> : null}
                    {c.label}
                  </Link>
                </li>
              ))}
              <li className="flex min-w-0 items-center gap-2">
                <span aria-hidden className="text-ink-2">
                  /
                </span>
                <span aria-current="page" className="truncate text-ink">
                  {collection.name}
                </span>
              </li>
            </ol>
          </nav>

          <div className="mt-auto pt-16">
            <p className="text-sm text-(color:--sf-accent)">A collection by {brand.name}</p>
            <h1 className={cn("mt-3 max-w-4xl text-balance text-ink", type.family, type.heroSplit)}>{collection.name}</h1>
            <p className="mt-4 max-w-md text-pretty text-[0.9375rem] leading-relaxed text-ink/80 md:text-base">{collection.description}</p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-page px-4 md:px-8">
        <section aria-labelledby="collection-products" className="mt-10 md:mt-14">
          <div className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-line-soft pb-4">
            <h2 id="collection-products" className="text-base text-ink tabular">
              {products.length} {products.length === 1 ? "piece" : "pieces"}
            </h2>
            {products.length > 1 ? (
              <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
                <SelectTrigger aria-label="Sort pieces" className="h-11 min-w-52 rounded-md border-line bg-surface px-3 text-sm data-[size=default]:h-11">
                  <span className="text-ink-3">Sort</span>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" align="end">
                  {sorts.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>

          {products.length ? (
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={sort}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: duration.page, ease: ease.out }}
                className="grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-4 md:grid-cols-3 lg:grid-cols-4"
              >
                {sorted.map((p, i) => (
                  <ShopProductCard key={p.id} product={p} priority={i < 2} />
                ))}
              </motion.div>
            </AnimatePresence>
          ) : (
            <EmptyCard
              icon={<PackageOpen />}
              title="Nothing in this collection right now"
              reason={`Its pieces have sold out or been taken down; the rest of ${brand.name} is still open.`}
              action={
                <Button asChild variant="primary">
                  <Link href={storefront}>Visit {brand.name}</Link>
                </Button>
              }
            />
          )}
        </section>

        {others.length ? (
          <section aria-labelledby="more-collections" className="mt-24 md:mt-32">
            <div className="mb-6 flex items-end justify-between gap-6 md:mb-8">
              <h2 id="more-collections" className={cn(type.family, type.heading, "text-ink")}>More from {brand.name}</h2>
              <AccentLink href={storefront}>Visit the storefront</AccentLink>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {others.map((c) => (
                <Link key={c.id} href={collectionHref(brand.handle, c)} className="group relative isolate flex aspect-[4/3] flex-col justify-end overflow-hidden rounded-lg bg-card p-5">
                  <Image src={c.image.src} alt={c.image.alt} fill sizes="(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 100vw" className="-z-10 object-cover transition-transform duration-[900ms] ease-out-quint group-hover:scale-[1.04]" />
                  <span aria-hidden className="scrim-b absolute inset-0 -z-10" />
                  <h3 className={cn(type.family, type.title, "text-ink")}>{c.name}</h3>
                  <p className="mt-2 text-sm text-ink/80">{c.description}</p>
                  <p className="mt-2 text-xs text-ink-2 tabular">{c.productIds.length} {c.productIds.length === 1 ? "piece" : "pieces"}</p>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
}
