"use client"

import Image from "next/image"
import { ImageIcon, PlusIcon as Plus } from "@phosphor-icons/react"
import { BrandMark } from "@/components/market/brand-mark"
import { accentStyle, storefrontSections, storefrontType } from "@/components/storefront/theme"
import { countries } from "@/config/markets"
import { formatMoney } from "@/lib/money"
import { cn } from "@/lib/utils"
import type { StorefrontTemplate, StorefrontTypePreset } from "@/lib/data/types"
import { initials } from "./options"
import type { ImageRef, OnboardingData } from "./store"
import { parsePrice } from "./validation"

type MarkSize = "xs" | "sm" | "md" | "lg" | "xl"
const logoSizes: Record<MarkSize, string> = { xs: "size-6 rounded-[4px]", sm: "size-8 rounded-[5px]", md: "size-11 rounded-md", lg: "size-16 rounded-lg", xl: "size-24 rounded-xl" }

/** The brand's uploaded logo, or the generated typographic mark. */
export function BrandLogo({ brand, size = "md", className }: { brand: OnboardingData["brand"]; size?: MarkSize; className?: string }) {
  if (brand.logoMode === "upload" && brand.logo) {
    return (
      <span className={cn("relative inline-flex shrink-0 overflow-hidden border border-white/12 bg-obsidian", logoSizes[size], className)}>
        <Image src={brand.logo.src} alt={brand.logo.alt} fill sizes="96px" className="object-contain p-[8%]" />
      </span>
    )
  }
  const text = brand.markText.trim() || initials(brand.name)
  if (!text) return <span aria-hidden className={cn("inline-flex shrink-0 border border-dashed border-white/20 bg-obsidian/60", logoSizes[size], className)} />
  return <BrandMark brand={{ name: brand.name || "Your brand", mark: { text, style: brand.markStyle } }} size={size} className={className} />
}

/**
 * Headline sizes for the miniature. The family comes from the storefront theme; the sizes
 * keep the theme's proportions (container units, same ratios per preset) at preview scale.
 */
const miniType: Record<StorefrontTypePreset, { hero: string; split: string; heading: string }> = {
  condensed: { hero: "text-[clamp(2.25rem,15cqw,5.5rem)] leading-[0.82]", split: "text-[clamp(1.75rem,9cqw,3.5rem)] leading-[0.84]", heading: "text-[clamp(1.25rem,5.6cqw,2.25rem)] leading-[0.88]" },
  grotesk: { hero: "text-[clamp(1.75rem,9.5cqw,3.75rem)] leading-[0.9]", split: "text-[clamp(1.375rem,5.6cqw,2.5rem)] leading-[0.92]", heading: "text-[clamp(1rem,3.8cqw,1.625rem)] leading-[0.98]" },
  expanded: { hero: "text-[clamp(1.25rem,6.8cqw,2.75rem)] leading-[0.94]", split: "text-[clamp(1.125rem,4cqw,1.875rem)] leading-[0.96]", heading: "text-[clamp(0.875rem,3cqw,1.375rem)] leading-[1]" },
}

function Cover({ cover, className, sizes, eager, imageClassName, label = true }: { cover: ImageRef | null; className?: string; sizes: string; eager?: boolean; imageClassName?: string; label?: boolean }) {
  return (
    <div className={cn("overflow-hidden bg-surface", className)}>
      {cover ? (
        <Image src={cover.src} alt={cover.alt} fill sizes={sizes} loading={eager ? "eager" : undefined} fetchPriority={eager ? "high" : undefined} className={cn("object-cover", imageClassName)} />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-white/[0.03] text-ink-3">
          {label ? (
            <>
              <ImageIcon className="size-5" aria-hidden />
              <span className="text-[11px]">Cover photo</span>
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}

/** The storefront's two hero actions, drawn (not live): Shop is the acid action, Follow is quiet. */
function Actions({ name, hasProduct, large, glass, shopLabel }: { name: string; hasProduct: boolean; large: boolean; glass?: boolean; shopLabel?: string }) {
  const size = large ? "h-9 px-4 text-xs" : "h-7 px-2.5 text-[10px]"
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-hidden>
      {hasProduct ? <span className={cn("inline-flex max-w-full items-center truncate rounded-md bg-acid font-medium text-obsidian", size)}>{shopLabel ?? `Shop ${name}`}</span> : null}
      <span className={cn("inline-flex items-center gap-1 rounded-md font-medium text-ink", size, glass ? "glass" : "border border-line")}>
        <Plus className={large ? "size-3.5" : "size-3"} /> Follow
      </span>
    </div>
  )
}

function ProductTile({ data, large }: { data: OnboardingData; large?: boolean }) {
  const p = data.product
  const currency = data.business.currency ?? "USD"
  const price = parsePrice(p.price, currency)
  const image = p.images[0]
  return (
    <div className="min-w-0">
      <div className="relative aspect-[4/5] overflow-hidden rounded-md bg-surface">
        {image ? <Image src={image.src} alt={image.alt} fill sizes={large ? "240px" : "160px"} className="object-cover" /> : null}
      </div>
      <p className={cn("mt-1.5 truncate text-ink", large ? "text-sm" : "text-[11px]")}>{p.name.trim() || "Your first product"}</p>
      <p className={cn("text-ink-2 tabular", large ? "text-xs" : "text-[10px]")}>{price !== null ? formatMoney(price, currency) : "Price"}</p>
    </div>
  )
}

function Placeholder({ large }: { large?: boolean }) {
  return (
    <div className="min-w-0" aria-hidden>
      <div className="flex aspect-[4/5] items-center justify-center rounded-md border border-dashed border-line text-center">
        <span className={cn("px-2 text-ink-3", large ? "text-xs" : "text-[10px]")}>Next product</span>
      </div>
      <p className={cn("mt-1.5 h-3 w-3/4 rounded-[3px] bg-white/5", large && "h-3.5")} />
      <p className="mt-1 h-2.5 w-1/3 rounded-[3px] bg-white/5" />
    </div>
  )
}

/** The featured section, headed the way each template heads its sections. */
function Featured({ data, template, large }: { data: OnboardingData; template: StorefrontTemplate; large: boolean }) {
  const family = storefrontType[data.storefront.typePreset]?.family ?? storefrontType.condensed.family
  const size = miniType[data.storefront.typePreset]?.heading ?? miniType.condensed.heading
  const title = storefrontSections["featured-products"].defaultTitle
  const hasProduct = data.product.images.length > 0 || !!data.product.name.trim()
  const cols = large ? 3 : 2
  const heading = <p className={cn(family, size, "text-ink")}>{title}</p>

  return (
    <div className={large ? "px-6 pt-8 pb-6" : "px-4 pt-6 pb-4"}>
      {template === "editorial" ? (
        <div className="mb-3">
          <p className="text-[11px] text-(color:--sf-detail) tabular">01</p>
          <div className="mt-1">{heading}</div>
        </div>
      ) : template === "minimal" ? (
        <div className="mb-3 border-t border-line-soft pt-3">{heading}</div>
      ) : template === "street" ? (
        <div className="mb-3">
          {heading}
          <span aria-hidden className="mt-1.5 block h-0.5 w-8 bg-(color:--sf-rule)" />
        </div>
      ) : (
        <div className="mb-3 grid gap-1.5">
          <p className="flex items-center gap-2 text-[11px] text-ink-3 tabular" aria-hidden>
            <span>01</span>
            <span className="h-px w-6 bg-line" />
          </p>
          {heading}
        </div>
      )}
      <div className={cn("grid gap-2", cols === 3 ? "grid-cols-3" : "grid-cols-2", large && "gap-3")}>
        {hasProduct ? <ProductTile data={data} large={large} /> : <Placeholder large={large} />}
        <Placeholder large={large} />
        {cols === 3 ? <Placeholder large={large} /> : null}
      </div>
    </div>
  )
}

/**
 * A live, scaled-down picture of the storefront as it takes shape. Each template's opening
 * follows the storefront renderer's hero for that template, and the accent and headline
 * type come from the same theme module, so what is chosen here is what the storefront shows.
 */
export function StorefrontPreview({ data, size = "panel", eager, className }: { data: OnboardingData; size?: "panel" | "large"; eager?: boolean; className?: string }) {
  const { brand, storefront, business } = data
  const large = size === "large"
  const template: StorefrontTemplate = storefront.template ?? "editorial"
  const name = brand.name.trim() || "Your brand"
  const intro = brand.description.trim() || "A line about what you make and where you make it."
  const place = business.city.trim() && business.country ? `${business.city.trim()}, ${countries[business.country].name}` : business.country ? countries[business.country].name : "Your city"
  const family = storefrontType[storefront.typePreset]?.family ?? storefrontType.condensed.family
  const mini = miniType[storefront.typePreset] ?? miniType.condensed
  const hasProduct = data.product.images.length > 0 || !!data.product.name.trim()
  const coverSizes = large ? "(min-width: 1024px) 720px, 100vw" : "380px"
  const pad = large ? "p-6" : "p-4"

  const title = (cls: string) => <p className={cn(family, "text-balance break-words text-ink", cls)}>{name}</p>
  const desc = (cls?: string) => <p className={cn("text-pretty", large ? "text-sm" : "text-[11px] leading-snug", !brand.description.trim() && "text-ink-3", cls)}>{intro}</p>

  return (
    <div style={accentStyle(storefront.accent)} className={cn("@container overflow-hidden rounded-lg border border-line-soft bg-obsidian", className)}>
      <div className="flex items-center gap-2 border-b border-line-soft bg-card px-3 py-2" aria-hidden>
        <span className="flex gap-1">
          <span className="size-2 rounded-full bg-line" />
          <span className="size-2 rounded-full bg-line" />
          <span className="size-2 rounded-full bg-line" />
        </span>
        <span className="min-w-0 flex-1 truncate rounded-md bg-surface px-2 py-1 text-[11px] text-ink-3">/brands/{brand.handle || "your-brand"}</span>
      </div>

      {template === "editorial" ? (
        // A masthead set across the top of a full-bleed photograph.
        <div className="relative isolate">
          <Cover cover={storefront.cover} sizes={coverSizes} eager={eager} label={false} className="absolute inset-0 -z-10" />
          <span aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-b from-obsidian/80 via-obsidian/10 to-obsidian" />
          <div className={cn("flex flex-col", large ? "min-h-[440px]" : "min-h-[300px]", pad)}>
            <div className={cn("flex items-center justify-between gap-3 border-b border-white/15 pb-2.5 text-ink/80", large ? "text-xs" : "text-[10px]")}>
              <span className="inline-flex min-w-0 items-center gap-2">
                <BrandLogo brand={brand} size="xs" />
                <span className="truncate">{place}</span>
              </span>
              <span className="shrink-0">New brand</span>
            </div>
            {title(cn("mt-3", mini.hero))}
            <div className={cn("mt-auto grid gap-3", large ? "pt-10" : "pt-6")}>
              {desc("max-w-md text-ink/85")}
              <Actions name={name} hasProduct={hasProduct} large={large} glass />
            </div>
          </div>
        </div>
      ) : null}

      {template === "minimal" ? (
        // A quiet column: the cover held in a frame, then the mark, name and intro.
        <div className={cn(large ? "px-6 pt-8" : "px-4 pt-5")}>
          <Cover cover={storefront.cover} sizes={coverSizes} eager={eager} className="relative aspect-[4/3] rounded-lg bg-card" />
          <BrandLogo brand={brand} size={large ? "lg" : "md"} className="mt-5" />
          {title(cn("mt-4", mini.split))}
          {desc("mt-3 max-w-md text-ink-2")}
          <div className="mt-4">
            <Actions name={name} hasProduct={hasProduct} large={large} />
          </div>
        </div>
      ) : null}

      {template === "street" ? (
        // The name as big as the frame allows, then an accent-ruled info bar.
        <>
          <div className="relative isolate">
            <Cover cover={storefront.cover} sizes={coverSizes} eager={eager} label={false} imageClassName="grayscale-[0.35]" className="absolute inset-0 -z-10" />
            <span aria-hidden className="absolute inset-0 -z-10 bg-obsidian/45" />
            <span aria-hidden className="absolute inset-x-0 bottom-0 -z-10 h-2/3 bg-gradient-to-t from-obsidian via-obsidian/60 to-transparent" />
            <div className={cn("flex flex-col justify-end", large ? "min-h-[360px]" : "min-h-[240px]", pad)}>
              {desc(cn("line-clamp-2 max-w-md font-medium", storefront.accent === "acid" || storefront.accent === "violet" ? "text-ink" : "text-(color:--sf-accent)"))}
              {title(cn("mt-2 -ml-[0.04em]", mini.hero))}
            </div>
          </div>
          <div className="border-y-2 border-(color:--sf-rule) bg-obsidian">
            <div className={cn("flex items-center gap-2.5", large ? "px-6 py-3" : "px-4 py-2.5")}>
              <BrandLogo brand={brand} size="sm" />
              <span className={cn("min-w-0 flex-1 truncate text-ink-2", large ? "text-xs" : "text-[10px]")}>{place}</span>
              <Actions name={name} hasProduct={hasProduct} large={large} shopLabel="Shop all" />
            </div>
          </div>
        </>
      ) : null}

      {template === "studio" ? (
        // A gallery wall: text first, then plated images with catalogue numbers.
        <div className={cn(large ? "px-6 pt-8" : "px-4 pt-5")}>
          <div className="flex items-center gap-2.5">
            <BrandLogo brand={brand} size={large ? "md" : "sm"} />
            <span className={cn("min-w-0 truncate text-ink-2", large ? "text-sm" : "text-[11px]")}>{place}</span>
          </div>
          {title(cn("mt-4", mini.split))}
          {desc("mt-3 max-w-md text-ink-2")}
          <div className="mt-4">
            <Actions name={name} hasProduct={hasProduct} large={large} />
          </div>
          <div className={cn("mt-5 grid grid-cols-[2fr_1fr]", large ? "gap-3" : "gap-2")}>
            <Plate caption={name} number={1} large={large}>
              <Cover cover={storefront.cover} sizes={large ? "480px" : "240px"} eager={eager} className="absolute inset-0" />
            </Plate>
            <Plate caption={data.product.name.trim() || "First product"} number={2} large={large}>
              {data.product.images[0] ? (
                <Image src={data.product.images[0].src} alt={data.product.images[0].alt} fill sizes={large ? "240px" : "120px"} className="object-cover" />
              ) : (
                <span className="absolute inset-0 rounded-[inherit] border border-dashed border-line" aria-hidden />
              )}
            </Plate>
          </div>
        </div>
      ) : null}

      <Featured data={data} template={template} large={large} />
    </div>
  )
}

function Plate({ caption, number, large, children }: { caption: string; number: number; large: boolean; children: React.ReactNode }) {
  return (
    <figure className={cn("flex min-w-0 flex-col rounded-md border border-line-soft bg-card", large ? "p-2.5" : "p-1.5")}>
      <div className={cn("relative flex-1 overflow-hidden rounded-[4px] bg-surface", large ? "min-h-48" : "min-h-28")}>{children}</div>
      <figcaption className={cn("mt-1.5 flex items-baseline justify-between gap-2", large ? "text-xs" : "text-[10px]")}>
        <span className="truncate text-ink-2">{caption}</span>
        <span className="shrink-0 text-ink-3 tabular">{String(number).padStart(2, "0")}</span>
      </figcaption>
    </figure>
  )
}
