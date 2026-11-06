"use client"

import Image from "next/image"
import Link from "next/link"
import { ArrowUpRightIcon as ArrowUpRight, PlusIcon as Plus } from "@phosphor-icons/react"
import { BrandMark } from "@/components/market/brand-mark"
import { FollowButton } from "@/components/market/follow-button"
import { Button } from "@/components/ui/button"
import { countries } from "@/config/markets"
import { site } from "@/config/site"
import { formatNumber } from "@/lib/money"
import { cn } from "@/lib/utils"
import type { Brand, Collection, StorefrontSection, StorefrontTemplate } from "@/lib/data/types"
import { collectionIndexId, sectionTitle, type TypeTokens } from "./theme"

/** Everything a section needs to know about the storefront it sits in. */
export type StorefrontContext = {
  brand: Brand
  template: StorefrontTemplate
  type: TypeTokens
  preview: boolean
}

/**
 * Section spacing, the marketplace rhythm (mt-24 md:mt-32) in container units so a draft in
 * an editor pane spaces like the live page. Templates differ in layout, not in rhythm.
 */
const rhythm = "mt-24 @3xl:mt-32"

/** Clearance under the floating marketplace header; not needed inside an editor preview. */
export const headerClearance = "pt-28 md:pt-32"

/** The announcement bar sits just under the floating header, closer than page content. */
export const announcementClearance = "pt-19 sm:pt-20"

export function Container({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("mx-auto w-full max-w-page px-4 @3xl:px-8", className)}>{children}</div>
}

export function SectionShell({
  ctx,
  section,
  first,
  className,
  children,
}: {
  ctx: StorefrontContext
  section: StorefrontSection
  first: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <section
      id={`sf-${section.id}`}
      aria-labelledby={`sf-${section.id}-title`}
      data-section={section.type}
      className={cn("scroll-mt-24", first ? (ctx.preview ? "pt-8" : headerClearance) : rhythm, className)}
    >
      {children}
    </section>
  )
}

/**
 * Section heading in the brand's headline type. Templates differ: Editorial numbers its
 * sections, Minimal sets small headings under a hairline, Street underlines in the accent,
 * Studio labels sections like a catalogue.
 */
export function SectionHeading({
  ctx,
  section,
  index,
  description,
  action,
  className,
}: {
  ctx: StorefrontContext
  section: StorefrontSection
  index: number
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  const id = `sf-${section.id}-title`
  const title = sectionTitle(section)
  const number = String(index).padStart(2, "0")
  const { template, type } = ctx

  if (template === "minimal") {
    return (
      <div className={cn("mb-8 flex items-end justify-between gap-6 border-t border-line-soft pt-6", className)}>
        <div className="max-w-xl">
          <h2 id={id} className={cn(type.family, type.title, "text-ink")}>{title}</h2>
          {description ? <p className="mt-2 text-sm leading-relaxed text-ink-2">{description}</p> : null}
        </div>
        {action}
      </div>
    )
  }

  if (template === "street") {
    return (
      <div className={cn("mb-6 flex items-end justify-between gap-6 @3xl:mb-8", className)}>
        <div className="max-w-3xl">
          <h2 id={id} className={cn(type.family, type.heading, "text-ink")}>{title}</h2>
          <span aria-hidden className="mt-3 block h-1 w-16 bg-(color:--sf-accent)" />
          {description ? <p className="mt-4 max-w-xl text-[0.9375rem] leading-relaxed text-ink-2">{description}</p> : null}
        </div>
        {action}
      </div>
    )
  }

  if (template === "studio") {
    return (
      <div className={cn("mb-8 grid gap-3 @3xl:grid-cols-[10rem_1fr_auto] @3xl:items-end @3xl:gap-8", className)}>
        <p className="flex items-center gap-3 text-xs text-ink-3 tabular" aria-hidden>
          <span>{number}</span>
          <span className="h-px w-10 bg-line" />
        </p>
        <div className="max-w-2xl">
          <h2 id={id} className={cn(type.family, type.heading, "text-ink")}>{title}</h2>
          {description ? <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-2">{description}</p> : null}
        </div>
        {action}
      </div>
    )
  }

  // editorial
  return (
    <div className={cn("mb-8 flex items-end justify-between gap-6 @3xl:mb-10", className)}>
      <div className="max-w-3xl">
        <p className="text-sm text-(color:--sf-accent) tabular">{number}</p>
        <h2 id={id} className={cn("mt-2", type.family, type.heading, "text-ink")}>{title}</h2>
        {description ? <p className="mt-4 max-w-xl text-pretty text-[0.9375rem] leading-relaxed text-ink-2">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}

/** A text link in the brand accent, used for section actions. */
export function AccentLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn("group inline-flex min-h-10 shrink-0 items-center gap-1 rounded-md py-1 text-sm text-ink-2 transition-colors hover:text-(color:--sf-accent) lg:min-h-0", className)}>
      {children}
      <ArrowUpRight className="size-4 transition-transform duration-300 ease-out-quint group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
    </Link>
  )
}

/** In an editor preview, an empty section explains itself instead of disappearing. */
export function PreviewPlaceholder({ ctx, section, first, index, reason }: { ctx: StorefrontContext; section: StorefrontSection; first: boolean; index: number; reason: string }) {
  return (
    <SectionShell ctx={ctx} section={section} first={first}>
      <Container>
        <SectionHeading ctx={ctx} section={section} index={index} />
        <div className="rounded-lg border border-dashed border-line px-5 py-10 text-center">
          <p className="text-sm text-ink">This section is empty</p>
          <p className="mt-1 text-sm text-ink-2">{reason} Until then it stays hidden on your live storefront.</p>
        </div>
      </Container>
    </SectionShell>
  )
}

export function placeOf(brand: Brand) {
  return `${brand.city}, ${countries[brand.country].name}`
}

/** Follow, or an inert stand-in inside the editor so a brand never follows itself. */
export function FollowAction({ ctx, variant = "default", size = "default", className }: { ctx: StorefrontContext; variant?: "default" | "glass"; size?: "sm" | "default" | "lg"; className?: string }) {
  if (ctx.preview) {
    return (
      <Button type="button" size={size} variant={variant === "glass" ? "glass" : "secondary"} disabled className={className}>
        <Plus />
        Follow
      </Button>
    )
  }
  return <FollowButton brandId={ctx.brand.id} brandName={ctx.brand.name} size={size} variant={variant} className={className} />
}

/** Where the brand is, when it started and how many people follow it, as separate facts. */
type Fact = "place" | "founded" | "followers"

export function BrandFacts({
  brand,
  className,
  tone = "default",
  show = ["place", "founded", "followers"],
}: {
  brand: Brand
  className?: string
  tone?: "default" | "onImage"
  show?: Fact[]
}) {
  const all: Record<Fact, { label: string; value: string }> = {
    place: { label: "Based in", value: placeOf(brand) },
    founded: { label: "Founded", value: String(brand.founded) },
    followers: { label: "Followers", value: formatNumber(brand.followers, { compact: true }) },
  }
  const facts = show.map((key) => all[key])
  return (
    <dl className={cn("flex flex-wrap gap-x-8 gap-y-3", className)}>
      {facts.map((f) => (
        <div key={f.label}>
          <dt className={cn("text-xs", tone === "onImage" ? "text-ink/70" : "text-ink-3")}>{f.label}</dt>
          <dd className="mt-0.5 text-sm text-ink tabular">{f.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function socialLinksOf(brand: Brand) {
  const s = brand.social
  return [
    s.instagram ? { label: "Instagram", href: `https://instagram.com/${s.instagram}` } : null,
    s.tiktok ? { label: "TikTok", href: `https://www.tiktok.com/@${s.tiktok}` } : null,
    s.x ? { label: "X", href: `https://x.com/${s.x}` } : null,
    s.website ? { label: "Website", href: `https://${s.website}` } : null,
  ].filter((l): l is { label: string; href: string } => !!l)
}

export function SocialLinks({ brand, className, tone = "default" }: { brand: Brand; className?: string; tone?: "default" | "onImage" }) {
  const links = socialLinksOf(brand)
  if (!links.length) return null
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-5 lg:gap-y-2", className)} aria-label={`${brand.name} elsewhere`}>
      {links.map((l) => (
        <li key={l.label}>
          <a
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${brand.name} on ${l.label} (opens in a new tab)`}
            className={cn(
              "group inline-flex min-h-10 items-center gap-1 rounded-sm text-sm transition-colors hover:text-(color:--sf-accent) lg:min-h-0",
              tone === "onImage" ? "text-ink/85" : "text-ink-2",
            )}
          >
            {l.label}
            <ArrowUpRight className="size-3.5 transition-transform duration-300 ease-out-quint group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </a>
        </li>
      ))}
    </ul>
  )
}

/**
 * The brand's own announcement bar: a soft tint of its accent with an accent border, never a
 * solid fill, so the hero's Shop button stays the only filled action in the first view (with
 * an acid accent, two acid fills would compete).
 */
export function AnnouncementBar({ ctx, text, href }: { ctx: StorefrontContext; text: string; href?: string }) {
  const body = (
    <>
      <span className="inline-flex size-1.5 shrink-0 rounded-full bg-(color:--sf-accent)" aria-hidden />
      <span className="text-pretty">{text}</span>
      {href ? <ArrowUpRight className="size-4 shrink-0 text-(color:--sf-accent) transition-transform duration-300 ease-out-quint group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden /> : null}
    </>
  )
  const bar = "flex items-center justify-center gap-2.5 rounded-md border border-(color:--sf-accent) bg-(color:--sf-accent-soft) px-4 py-2.5 text-center text-sm text-ink"
  return (
    <div className={cn(!ctx.preview && announcementClearance)}>
      <Container>
        <div role="note" aria-label={`Announcement from ${ctx.brand.name}`}>
          {href ? (
            <Link href={href} className={cn("group transition-colors hover:bg-(color:--sf-accent)/20", bar)}>
              {body}
            </Link>
          ) : (
            <p className={bar}>{body}</p>
          )}
        </div>
      </Container>
    </div>
  )
}

/**
 * A short index of the brand's collections, shown under the hero when the collections
 * section is off (Street leaves it out), so every collection page can be reached from the
 * storefront and its breadcrumb has somewhere to land.
 */
export function CollectionIndex({ ctx, collections, first }: { ctx: StorefrontContext; collections: Collection[]; first: boolean }) {
  const { brand } = ctx
  return (
    <section
      id={collectionIndexId}
      aria-labelledby={`${collectionIndexId}-title`}
      className={cn("scroll-mt-24", first ? (ctx.preview ? "pt-8" : headerClearance) : "mt-10 @3xl:mt-14")}
    >
      <Container className="grid gap-4 @3xl:grid-cols-[10rem_minmax(0,1fr)] @3xl:items-center @3xl:gap-8">
        <h2 id={`${collectionIndexId}-title`} className="text-sm text-ink-2">
          Collections
        </h2>
        <ul className="rail -mx-4 flex gap-3 overflow-x-auto px-4 @3xl:mx-0 @3xl:flex-wrap @3xl:overflow-visible @3xl:px-0">
          {collections.map((c) => (
            <li key={c.id} className="shrink-0">
              <Link
                href={`/brands/${brand.handle}/collections/${c.handle}`}
                className="group flex items-center gap-3 rounded-lg border border-line-soft p-2 pr-4 transition-colors hover:border-(color:--sf-accent)"
              >
                <span className="relative size-12 shrink-0 overflow-hidden rounded-md bg-card">
                  <Image src={c.image.src} alt="" fill sizes="48px" className="object-cover" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm text-ink transition-colors group-hover:text-(color:--sf-accent)">{c.name}</span>
                  <span className="block text-xs text-ink-3 tabular">
                    {c.productIds.length} {c.productIds.length === 1 ? "piece" : "pieces"}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  )
}

/** Policies every storefront shows; brands can't remove them. */
export function StorefrontFooter({ ctx }: { ctx: StorefrontContext }) {
  const { brand } = ctx
  const [minDays, maxDays] = brand.processingDays
  const facts = [
    { label: "Ships from", value: countries[brand.shipsFrom].name },
    { label: "Dispatched within", value: minDays === maxDays ? `${maxDays} working days` : `${minDays} to ${maxDays} working days` },
    { label: "Returns", value: `${brand.returnsDays} days from delivery` },
    { label: "Checkout", value: `One payment for every brand in your bag` },
  ]
  return (
    <Container className="mt-24 @3xl:mt-32">
      <div className="grid gap-8 border-t border-line-soft pt-8 @4xl:grid-cols-[minmax(0,1.2fr)_minmax(0,3fr)]">
        <div className="flex items-start gap-3">
          <BrandMark brand={brand} size="sm" />
          <div>
            <p className="text-sm text-ink">{brand.name}</p>
            <p className="mt-1 max-w-xs text-xs leading-relaxed text-ink-2">
              Sold and shipped by {brand.name}. Checkout runs through {site.name}.
            </p>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 @3xl:grid-cols-4">
          {facts.map((f) => (
            <div key={f.label}>
              <dt className="text-xs text-ink-3">{f.label}</dt>
              <dd className="mt-1 text-sm text-ink">{f.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Container>
  )
}
