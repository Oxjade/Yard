"use client"

import Image from "next/image"
import { ArrowUpRightIcon as ArrowUpRight } from "@phosphor-icons/react"
import { BrandCard } from "@/components/market/brand-card"
import { CollectionTile } from "@/components/market/editorial/collection-tile"
import { DropCard } from "@/components/market/drop-card"
import { ProductCard } from "@/components/market/product-card"
import { SponsoredTag } from "@/components/market/sponsored-tag"
import { brands, categoryBySlug, collections, curatedCollections, products as allProducts } from "@/lib/data"
import { campaignTypes, type CampaignType } from "@/lib/data/ads"
import type { Brand, CategorySlug, Drop, ImageAsset, Product } from "@/lib/data/types"
import { placementMeta } from "./utils"

export type ResolvedTarget = { id: string; kind: "brand" | "product" | "drop" | "collection" | "curated"; name: string; image: ImageAsset; product?: Product; drop?: Drop }

/** Turn a campaign's target id into something to show. Ids carry their kind in the prefix. */
export function resolveTarget(id: string | undefined, brand: Brand, studioProducts: Product[], studioDrops: Drop[]): ResolvedTarget | null {
  if (!id) return null
  if (id.startsWith("b_")) return { id, kind: "brand", name: brand.name, image: brand.cover }
  if (id.startsWith("p_")) {
    const p = studioProducts.find((x) => x.id === id)
    return p ? { id, kind: "product", name: p.name, image: p.images[0], product: p } : null
  }
  if (id.startsWith("d_")) {
    const d = studioDrops.find((x) => x.id === id)
    return d ? { id, kind: "drop", name: d.name, image: d.image, drop: d } : null
  }
  if (id.startsWith("cc_")) {
    const c = curatedCollections.find((x) => x.id === id)
    return c ? { id, kind: "curated", name: c.name, image: c.image } : null
  }
  if (id.startsWith("c_")) {
    const c = collections.find((x) => x.id === id)
    return c ? { id, kind: "collection", name: c.name, image: c.image } : null
  }
  return null
}

/**
 * How a sponsored placement will look to shoppers, built from the marketplace's own cards.
 * Read-only (inert), and always carrying the Sponsored label.
 */
export function PlacementPreview({ type, brand, target, categories }: { type: CampaignType; brand: Brand; target: ResolvedTarget | null; categories: string[] }) {
  const category = categoryBySlug.get((categories[0] ?? brand.categories[0]) as CategorySlug)
  const where = campaignTypes[type].placements.map((p) => placementMeta[p].label).join(", ")

  return (
    <figure className="grid gap-3">
      <div inert className="pointer-events-none overflow-hidden rounded-lg border border-line-soft bg-obsidian p-3 select-none md:p-5">
        {type === "sponsored-brand" ? <BrandSlot brand={brand} /> : null}
        {type === "sponsored-product" ? <ProductSlot product={target?.product} brand={brand} category={category?.slug} /> : null}
        {type === "sponsored-drop" ? target?.drop ? <DropCard drop={{ ...target.drop, sponsored: true }} layout="wide" eager /> : <Missing what="drop" /> : null}
        {type === "homepage-spotlight" ? <SpotlightSlot brand={brand} target={target} /> : null}
        {type === "category-promotion" ? <CategoryBanner brand={brand} target={target} categoryName={category?.name ?? "Category"} category={category?.slug} /> : null}
        {type === "editorial-sponsorship" ? <EditorialSlot brand={brand} curatedId={target?.kind === "curated" ? target.id : undefined} /> : null}
      </div>
      <figcaption className="text-xs text-ink-3">Shown in: {where}. The Sponsored label is always shown and can&apos;t be removed.</figcaption>
    </figure>
  )
}

function Missing({ what }: { what: string }) {
  return <p className="py-10 text-center text-sm text-ink-2">Choose a {what} in step 2 to see the preview.</p>
}

function BrandSlot({ brand }: { brand: Brand }) {
  const others = brands.filter((b) => b.id !== brand.id && b.categories.some((c) => brand.categories.includes(c))).slice(0, 2)
  const fill = others.length < 2 ? brands.filter((b) => b.id !== brand.id && !others.includes(b)).slice(0, 2 - others.length) : []
  const [a, b] = [...others, ...fill]
  return (
    <div>
      <p className="mb-3 text-xs text-ink-2">Discover, featured brands</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <BrandCard brand={a} className="opacity-35" />
        <BrandCard brand={brand} sponsored className="ring-1 ring-purple" />
        <BrandCard brand={b} className="hidden opacity-35 md:flex" />
      </div>
    </div>
  )
}

function ProductSlot({ product, brand, category }: { product?: Product; brand: Brand; category?: CategorySlug }) {
  if (!product) return <Missing what="product" />
  const organic = allProducts.filter((p) => p.brandId !== brand.id && p.status === "published" && (!category || p.category === category)).slice(0, 5)
  const pad = organic.length < 5 ? allProducts.filter((p) => p.brandId !== brand.id && !organic.includes(p)).slice(0, 5 - organic.length) : []
  const list = [...organic, ...pad]
  return (
    <div>
      <p className="mb-3 text-xs text-ink-2">{categoryBySlug.get(category ?? product.category)?.name ?? "Category"} grid, position 5</p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-5 md:grid-cols-3">
        {list.slice(0, 4).map((p) => (
          <ProductCard key={p.id} product={p} variant="compact" sizes="160px" className="opacity-35" />
        ))}
        <ProductCard product={product} variant="compact" sponsored sizes="200px" priority />
        {list[4] ? <ProductCard product={list[4]} variant="compact" sizes="160px" className="opacity-35" /> : null}
      </div>
    </div>
  )
}

function SpotlightSlot({ brand, target }: { brand: Brand; target: ResolvedTarget | null }) {
  const image = target?.image ?? brand.cover
  const title = target && target.kind !== "brand" ? target.name : brand.tagline
  return (
    <div className="relative isolate flex min-h-[300px] items-end overflow-hidden rounded-lg p-3 md:min-h-[340px] md:p-5">
      <Image src={brand.cover.src} alt="" fill loading="eager" sizes="(min-width: 1024px) 50vw, 90vw" className="-z-10 object-cover opacity-30 blur-[2px]" />
      <span className="scrim-b absolute inset-0 -z-10" />
      <p className="absolute top-3 left-3 text-xs text-ink-2 md:top-5 md:left-5">Discover hero, spotlight tile</p>
      <div className="glass glass-sheen ml-auto flex w-full max-w-sm items-center gap-3 rounded-2xl p-3">
        <span className="relative size-16 shrink-0 overflow-hidden rounded-lg">
          <Image src={image.src} alt="" fill sizes="64px" className="object-cover" />
        </span>
        <span className="min-w-0 flex-1">
          <SponsoredTag className="mb-1.5" />
          <span className="block truncate text-sm text-ink">{title}</span>
          <span className="block truncate text-xs text-ink-2">{brand.name}</span>
        </span>
        <ArrowUpRight className="size-4 shrink-0 text-ink-2" />
      </div>
    </div>
  )
}

function CategoryBanner({ brand, target, categoryName, category }: { brand: Brand; target: ResolvedTarget | null; categoryName: string; category?: CategorySlug }) {
  const image = target?.image ?? brand.cover
  const organic = allProducts.filter((p) => p.brandId !== brand.id && p.status === "published" && (!category || p.category === category)).slice(0, 4)
  return (
    <div>
      <p className="mb-3 text-xs text-ink-2">Top of {categoryName}</p>
      <div className="relative isolate flex min-h-[200px] flex-col justify-end overflow-hidden rounded-lg p-4 md:min-h-[220px] md:p-6">
        <Image src={image.src} alt="" fill loading="eager" sizes="(min-width: 1024px) 60vw, 90vw" className="-z-10 object-cover" />
        <span className="scrim-l absolute inset-0 -z-10" />
        <SponsoredTag className="absolute top-3 left-3 md:top-4 md:left-4" />
        <p className="text-xs text-ink-2">{brand.name}</p>
        <p className="mt-1 max-w-md text-xl font-medium text-ink md:text-2xl">{target && target.kind !== "brand" ? target.name : brand.tagline}</p>
        <span className="mt-3 inline-flex h-8 w-fit items-center rounded-md border border-white/20 px-3 text-xs text-ink">Shop {brand.name}</span>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2 opacity-35" aria-hidden>
        {organic.map((p) => (
          <span key={p.id} className="relative block aspect-[4/5] overflow-hidden rounded-md bg-surface">
            <Image src={p.images[0].src} alt="" fill sizes="120px" className="object-cover" />
          </span>
        ))}
      </div>
    </div>
  )
}

/** The marketplace's own CollectionTile, with this brand named as sponsor. */
function EditorialSlot({ brand, curatedId }: { brand: Brand; curatedId?: string }) {
  const c = curatedCollections.find((x) => x.id === curatedId)
  if (!c) return <Missing what="curated collection" />
  return (
    <div>
      <p className="mb-3 text-xs text-ink-2">Discover, curated collections</p>
      <CollectionTile collection={{ ...c, sponsoredBy: brand.id }} />
    </div>
  )
}
