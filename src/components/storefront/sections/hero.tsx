"use client"

import Image from "next/image"
import { BadgeCheck } from "lucide-react"
import { BrandMark } from "@/components/market/brand-mark"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { ImageAsset, Product, StorefrontSection } from "@/lib/data/types"
import { BrandFacts, Container, FollowAction, SocialLinks, headerClearance, placeOf, type StorefrontContext } from "../parts"

type HeroProps = {
  ctx: StorefrontContext
  section: StorefrontSection
  intro: string
  products: Product[]
  /** True when the hero is the first thing on the page (no announcement above it). */
  first: boolean
  /** In-page anchor for the main call to action, when there is something to shop. */
  shopHref?: string
}

/** The storefront's one primary action: go to the products. */
function ShopAction({ ctx, href, size = "lg", className }: { ctx: StorefrontContext; href?: string; size?: "default" | "lg"; className?: string }) {
  if (!href) return null
  return (
    <Button asChild variant="primary" size={size} className={className}>
      <a href={href}>Shop {ctx.brand.name}</a>
    </Button>
  )
}

function HeroName({ ctx, size = "hero", className }: { ctx: StorefrontContext; size?: "hero" | "heroSplit"; className?: string }) {
  const Tag = ctx.preview ? "h2" : "h1"
  return (
    <Tag id="sf-hero-title" className={cn(ctx.type.family, ctx.type[size], "text-balance break-words text-ink", className)}>
      {ctx.brand.name}
    </Tag>
  )
}

function Verified({ show }: { show: boolean }) {
  if (!show) return null
  return (
    <span className="inline-flex items-center gap-1 text-xs text-ink-2">
      <BadgeCheck className="size-4 text-violet" aria-hidden />
      Verified brand
    </span>
  )
}

export function HeroSection(props: HeroProps) {
  switch (props.ctx.template) {
    case "minimal":
      return <MinimalHero {...props} />
    case "street":
      return <StreetHero {...props} />
    case "studio":
      return <StudioHero {...props} />
    default:
      return <EditorialHero {...props} />
  }
}

/* Editorial: a magazine masthead set across the top of a full-bleed photograph. */
function EditorialHero({ ctx, intro, first, shopHref }: HeroProps) {
  const { brand, preview } = ctx
  return (
    <section id="sf-hero" aria-labelledby="sf-hero-title" data-section="hero" className="relative isolate overflow-hidden">
      <div className={cn("relative flex flex-col", preview ? "min-h-[600px]" : "min-h-[640px] @3xl:min-h-[min(100svh,960px)]")}>
        <Image src={brand.cover.src} alt={brand.cover.alt} fill preload={!preview} sizes={preview ? "(min-width: 1024px) 60vw, 100vw" : "100vw"} className="-z-10 object-cover" />
        {/* A flat tint keeps the masthead legible; the scrims carry the type at the foot. */}
        <span aria-hidden className="absolute inset-0 -z-10 bg-obsidian/30" />
        <span aria-hidden className="scrim-l absolute inset-0 -z-10" />
        <span aria-hidden className="scrim-b absolute inset-0 -z-10" />
        <Container className={cn("flex flex-1 flex-col justify-between pb-10 @3xl:pb-14", first && !preview ? headerClearance : "pt-10")}>
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/15 pb-4 text-xs text-ink/80">
              <span className="inline-flex items-center gap-2.5">
                <BrandMark brand={brand} size="xs" />
                {placeOf(brand)}
              </span>
              <span className="tabular">Since {brand.founded}</span>
            </div>
            <HeroName ctx={ctx} className="mt-5 @3xl:mt-6" />
          </div>
          <div className="mt-16 grid gap-8 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] @4xl:items-end">
            <p className="max-w-xl text-pretty text-2xl leading-tight text-ink @3xl:text-3xl">{brand.tagline}</p>
            <div>
              <p className="text-pretty text-[0.9375rem] leading-relaxed text-ink/85">{intro}</p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <ShopAction ctx={ctx} href={shopHref} />
                <FollowAction ctx={ctx} variant="glass" size="lg" />
                <BrandFacts brand={brand} tone="onImage" show={["followers"]} className="@3xl:ml-2" />
              </div>
              <SocialLinks brand={brand} tone="onImage" className="mt-5" />
            </div>
          </div>
        </Container>
      </div>
    </section>
  )
}

/* Minimal: a quiet split, the cover held in a frame rather than bled to the edges. */
function MinimalHero({ ctx, intro, first, shopHref }: HeroProps) {
  const { brand, preview } = ctx
  return (
    <section id="sf-hero" aria-labelledby="sf-hero-title" data-section="hero" className={cn(first && !preview ? headerClearance : "pt-8")}>
      <Container className="grid gap-8 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] @4xl:items-end @4xl:gap-14">
        <figure className="relative aspect-[4/3] overflow-hidden rounded-lg bg-card @4xl:order-last @4xl:aspect-[4/5]">
          <Image src={brand.cover.src} alt={brand.cover.alt} fill preload={!preview} sizes="(min-width: 1024px) 50vw, 100vw" className="object-cover" />
        </figure>
        <div className="@4xl:pb-2">
          <div className="flex items-center gap-3">
            <BrandMark brand={brand} size="lg" />
            <Verified show={brand.verified} />
          </div>
          <HeroName ctx={ctx} size="heroSplit" className="mt-8" />
          <p className="mt-5 max-w-md text-pretty text-lg leading-snug text-ink-2">{brand.tagline}</p>
          <p className="mt-8 max-w-md text-pretty text-[0.9375rem] leading-relaxed text-ink">{intro}</p>
          <BrandFacts brand={brand} className="mt-10 border-t border-line-soft pt-6" />
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <ShopAction ctx={ctx} href={shopHref} size="default" />
            <FollowAction ctx={ctx} />
          </div>
          <SocialLinks brand={brand} className="mt-6" />
        </div>
      </Container>
    </section>
  )
}

/* Street: the name as big as the page allows, then an accent-ruled info bar. */
function StreetHero({ ctx, intro, first, shopHref }: HeroProps) {
  const { brand, preview } = ctx
  return (
    <section id="sf-hero" aria-labelledby="sf-hero-title" data-section="hero" className="relative isolate">
      <div className={cn("relative flex flex-col justify-end overflow-hidden", preview ? "min-h-[540px]" : "min-h-[600px] @3xl:min-h-[min(88svh,880px)]")}>
        <Image src={brand.cover.src} alt={brand.cover.alt} fill preload={!preview} sizes={preview ? "(min-width: 1024px) 60vw, 100vw" : "100vw"} className="-z-10 object-cover grayscale-[0.35]" />
        <span aria-hidden className="absolute inset-0 -z-10 bg-obsidian/45" />
        <span aria-hidden className="scrim-b absolute inset-0 -z-10" />
        <Container className={cn("pb-6 @3xl:pb-8", first && !preview ? headerClearance : "pt-10")}>
          <p className="max-w-xl text-pretty text-base font-medium text-(color:--sf-accent) @3xl:text-lg">{brand.tagline}</p>
          <HeroName ctx={ctx} className="mt-3 -ml-[0.04em]" />
        </Container>
      </div>
      <div className="border-y-2 border-(color:--sf-accent) bg-obsidian">
        <Container className="flex flex-wrap items-center gap-x-8 gap-y-4 py-4">
          <BrandMark brand={brand} size="sm" />
          <BrandFacts brand={brand} className="gap-x-6" />
          <SocialLinks brand={brand} className="@5xl:ml-4" />
          <div className="grid w-full grid-cols-[auto_minmax(0,1fr)] gap-2 @2xl:ml-auto @2xl:flex @2xl:w-auto">
            <FollowAction ctx={ctx} />
            <ShopAction ctx={ctx} href={shopHref} size="default" />
          </div>
        </Container>
      </div>
      <Container className="mt-8 @3xl:mt-10">
        <p className="max-w-2xl text-pretty text-lg leading-snug text-ink @3xl:text-xl">{intro}</p>
      </Container>
    </section>
  )
}

/* Studio: a gallery wall. Text up top, then plated images with catalogue numbers. */
function StudioHero({ ctx, intro, products, first, shopHref }: HeroProps) {
  const { brand, preview } = ctx
  const plates: { image: ImageAsset; caption: string }[] = [{ image: brand.cover, caption: brand.name }]
  for (const p of products) {
    if (plates.length >= 3) break
    if (!plates.some((x) => x.image.src === p.images[0].src)) plates.push({ image: p.images[0], caption: p.name })
  }
  return (
    <section id="sf-hero" aria-labelledby="sf-hero-title" data-section="hero" className={cn(first && !preview ? headerClearance : "pt-8")}>
      <Container>
        <div className="grid gap-8 @4xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] @4xl:items-end @4xl:gap-16">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <BrandMark brand={brand} size="md" />
              <span className="text-sm text-ink-2">{placeOf(brand)}</span>
              <Verified show={brand.verified} />
            </div>
            <HeroName ctx={ctx} size="heroSplit" className="mt-6" />
          </div>
          <div>
            <p className="text-pretty text-xl leading-snug text-ink">{brand.tagline}</p>
            <p className="mt-4 text-pretty text-[0.9375rem] leading-relaxed text-ink-2">{intro}</p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <ShopAction ctx={ctx} href={shopHref} size="default" />
              <FollowAction ctx={ctx} />
            </div>
            <SocialLinks brand={brand} className="mt-5" />
          </div>
        </div>

        <div className="rail -mx-4 mt-10 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 @3xl:mx-0 @3xl:grid @3xl:grid-cols-[2fr_1fr_1fr] @3xl:gap-4 @3xl:overflow-visible @3xl:px-0 @3xl:pb-0">
          {plates.map((plate, i) => (
            <figure key={plate.image.src} className="w-[78%] shrink-0 snap-start rounded-lg border border-line-soft bg-card p-3 @3xl:w-auto @3xl:p-4">
              <div className={cn("relative overflow-hidden rounded-md bg-surface", i === 0 ? "aspect-[4/5] @3xl:aspect-[16/11]" : "aspect-[4/5] @3xl:aspect-auto @3xl:h-[calc(100%-2rem)]")}>
                <Image src={plate.image.src} alt={plate.image.alt} fill preload={!preview && i === 0} sizes={i === 0 ? "(min-width: 768px) 50vw, 78vw" : "(min-width: 768px) 25vw, 78vw"} className="object-cover" />
              </div>
              <figcaption className="mt-3 flex items-baseline justify-between gap-3 text-xs">
                <span className="truncate text-ink-2">{plate.caption}</span>
                <span className="shrink-0 text-ink-3 tabular">{String(i + 1).padStart(2, "0")}</span>
              </figcaption>
            </figure>
          ))}
        </div>
        <BrandFacts brand={brand} show={["founded", "followers"]} className="mt-8 border-t border-line-soft pt-6" />
      </Container>
    </section>
  )
}
