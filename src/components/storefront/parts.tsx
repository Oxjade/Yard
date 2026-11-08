"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import {
  ArrowUpRightIcon as ArrowUpRight,
  ChatCircleDotsIcon,
  CheckIcon as Check,
  GlobeSimpleIcon as Globe,
  InstagramLogoIcon as Instagram,
  PlusIcon as Plus,
  ShareNetworkIcon as ShareNetwork,
  TiktokLogoIcon as Tiktok,
  XLogoIcon as XLogo,
  type Icon,
} from "@phosphor-icons/react"
import { toast } from "sonner"
import { inboxHrefFor, useMessageBrand } from "@/components/inbox/entry/message-brand-button"
import { BrandMark } from "@/components/market/brand-mark"
import { FollowButton } from "@/components/market/follow-button"
import { Button } from "@/components/ui/button"
import { useAsyncAction } from "@/hooks/use-async-action"
import { countries } from "@/config/markets"
import { site } from "@/config/site"
import { formatNumber } from "@/lib/money"
import { useServerSession } from "@/lib/session/use-server-session"
import { cn } from "@/lib/utils"
import type { Brand, Collection, StorefrontAccent, StorefrontSection, StorefrontTemplate } from "@/lib/data/types"
import { collectionIndexId, sectionTitle, storefrontAccents, type TypeTokens } from "./theme"

/** Everything a section needs to know about the storefront it sits in. */
export type StorefrontContext = {
  brand: Brand
  template: StorefrontTemplate
  /** The accent the brand picked; the colour itself reaches classes as --sf-accent. */
  accent: StorefrontAccent
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
          <span aria-hidden className="mt-3 block h-1 w-16 bg-(color:--sf-rule)" />
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
        <p className="text-sm text-(color:--sf-detail) tabular">{number}</p>
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
export function FollowAction({ ctx, className }: { ctx: StorefrontContext; className?: string }) {
  if (ctx.preview) {
    return (
      <Button type="button" variant="secondary" disabled className={className}>
        <Plus />
        Follow
      </Button>
    )
  }
  return <FollowButton brandId={ctx.brand.id} brandName={ctx.brand.name} size="default" className={className} />
}

type ShareResult = "copied" | "sheet" | "dismissed"

/**
 * Share the storefront. On phones and tablets it opens the device's share sheet, which is its
 * own feedback (nothing claims the link was sent); elsewhere, or if the sheet can't open, it
 * copies the storefront's address, and the check in place of the icon is the confirmation (a
 * toast would repeat it; screen readers hear "Link copied"). Only a failed copy toasts, with
 * what to do instead. In the editor it is an inert stand-in, as Follow is.
 */
export function ShareAction({ ctx, className }: { ctx: StorefrontContext; className?: string }) {
  const { brand } = ctx
  const [result, setResult] = useState<ShareResult | null>(null)
  const share = useAsyncAction(
    async (): Promise<ShareResult> => {
      const url = new URL(`/brands/${brand.handle}`, window.location.origin).toString()
      if (typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches) {
        try {
          await navigator.share({ title: brand.name, text: brand.tagline, url })
          return "sheet"
        } catch (e) {
          // Closing the sheet is an answer, not a failure. Anything else falls back to copying.
          if (e instanceof DOMException && e.name === "AbortError") return "dismissed"
        }
      }
      await navigator.clipboard.writeText(url)
      return "copied"
    },
    {
      onSuccess: setResult,
      errorToast: false,
      onError: () => toast.error("Couldn't copy the link", { id: "sf-share", description: "Copy it from your browser's address bar instead." }),
    },
  )
  const copied = share.succeeded && result === "copied"
  const label = `Share ${brand.name}`
  const shape = cn("rounded-full", className)

  if (ctx.preview) {
    return (
      <Button type="button" size="icon" variant="secondary" disabled aria-label={label} className={shape}>
        <ShareNetwork />
      </Button>
    )
  }

  return (
    <Button type="button" size="icon" variant="secondary" aria-label={label} onClick={() => void share.run()} className={shape}>
      {copied ? <Check className="text-ink" /> : <ShareNetwork />}
      <span className="sr-only" role="status">{copied ? "Link copied" : ""}</span>
    </Button>
  )
}

/** The brand's key facts, each shown as its own label and value. */
export type BrandFact = "founded" | "followers" | "pieces" | "shipsFrom"

/**
 * The facts in the order asked for. `pieces` is the number of published pieces the storefront
 * lists (the renderer's products), so it is only shown when it is passed.
 */
export function brandFacts(brand: Brand, show: BrandFact[], { pieces }: { pieces?: number } = {}) {
  const all: Record<BrandFact, { label: string; value: string } | null> = {
    founded: { label: "Founded", value: String(brand.founded) },
    followers: { label: "Followers", value: formatNumber(brand.followers, { compact: true }) },
    pieces: pieces === undefined ? null : { label: pieces === 1 ? "Piece" : "Pieces", value: formatNumber(pieces) },
    shipsFrom: { label: "Ships from", value: countries[brand.shipsFrom].name },
  }
  return show.flatMap((key) => {
    const fact = all[key]
    return fact ? [{ key, ...fact }] : []
  })
}

type SocialLink = { key: string; label: string; href: string; icon: Icon; text: string }

/** A website as people write it: no scheme, no "www.", no trailing slash. */
const bareHost = (url: string) => url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "")

export function socialLinksOf(brand: Brand): SocialLink[] {
  const s = brand.social
  const site = s.website?.trim()
  return [
    s.instagram ? { key: "instagram", label: "Instagram", text: "Instagram", href: `https://instagram.com/${s.instagram}`, icon: Instagram } : null,
    s.tiktok ? { key: "tiktok", label: "TikTok", text: "TikTok", href: `https://www.tiktok.com/@${s.tiktok}`, icon: Tiktok } : null,
    s.x ? { key: "x", label: "X", text: "X", href: `https://x.com/${s.x}`, icon: XLogo } : null,
    site ? { key: "website", label: "Website", text: bareHost(site), href: /^https?:\/\//i.test(site) ? site : `https://${site}`, icon: Globe } : null,
  ].filter((l): l is SocialLink => !!l)
}

/**
 * Where else the brand is, as a profile shows it: each network's glyph and name, and the
 * website by its address. Every link opens in a new tab and says so to screen readers.
 */
export function SocialLinks({ brand, className }: { brand: Brand; className?: string }) {
  const links = socialLinksOf(brand)
  if (!links.length) return null
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-5 lg:gap-y-2", className)} aria-label={`${brand.name} elsewhere`}>
      {links.map((l) => (
        <li key={l.key}>
          {/* The padding, taken back by the margin, gives a short name such as X a 40px tap. */}
          <a
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={l.key === "website" ? `${brand.name} website, ${l.text} (opens in a new tab)` : `${brand.name} on ${l.label} (opens in a new tab)`}
            className="-mx-1.5 inline-flex min-h-10 min-w-10 items-center justify-center gap-1.5 rounded-sm px-1.5 text-sm text-ink-2 transition-colors duration-150 hover:text-(color:--sf-accent) lg:min-h-0"
          >
            <l.icon className="size-4 shrink-0" aria-hidden />
            {l.text}
          </a>
        </li>
      ))}
    </ul>
  )
}

/**
 * The brand's own announcement bar: a soft tint of its accent with a ruled border, never a
 * solid fill, so the hero's Shop button stays the only filled action in the first view. With
 * an acid accent (reserved for that button) the bar is a neutral wash under a quiet rule, and
 * only its small dot is acid.
 */
export function AnnouncementBar({ ctx, text, href }: { ctx: StorefrontContext; text: string; href?: string }) {
  const reserved = !!storefrontAccents[ctx.accent]?.reserved
  const body = (
    <>
      <span className="inline-flex size-1.5 shrink-0 rounded-full bg-(color:--sf-accent)" aria-hidden />
      <span className="text-pretty">{text}</span>
      {href ? (
        <ArrowUpRight
          className={cn("size-4 shrink-0 transition-transform duration-300 ease-out-quint group-hover:translate-x-0.5 group-hover:-translate-y-0.5", reserved ? "text-ink-2" : "text-(color:--sf-accent)")}
          aria-hidden
        />
      ) : null}
    </>
  )
  const bar = "flex items-center justify-center gap-2.5 rounded-md border border-(color:--sf-rule) bg-(color:--sf-accent-soft) px-4 py-2.5 text-center text-sm text-ink"
  return (
    <div className={cn(ctx.preview ? "pt-4" : announcementClearance)}>
      <Container>
        <div role="note" aria-label={`Announcement from ${ctx.brand.name}`}>
          {href ? (
            <Link href={href} className={cn("group transition-colors", reserved ? "hover:bg-white/[0.06]" : "hover:bg-(color:--sf-accent)/20", bar)}>
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

/**
 * "Questions? Message {brand}" under the footer blurb (§7.4). Guests go through sign-in first;
 * a member of this brand signed in to Studio is pointed at the Studio inbox instead (brands
 * reply there and never start conversations). Inert in the editor's preview.
 */
function FooterMessageLink({ ctx }: { ctx: StorefrontContext }) {
  const { brand } = ctx
  const go = useMessageBrand()
  const own = useServerSession((s) => s.brand?.brand.id === brand.id)
  const look = "-my-2 mt-0 inline-flex min-h-10 items-center gap-1.5 text-left text-xs text-ink-2 underline-offset-4 transition-colors hover:text-ink hover:underline md:min-h-8"
  if (ctx.preview) {
    return (
      <p className="mt-1 inline-flex min-h-8 items-center gap-1.5 text-xs text-ink-3">
        <ChatCircleDotsIcon className="size-3.5 shrink-0" aria-hidden />
        Questions? Message {brand.name} (works on your live storefront)
      </p>
    )
  }
  if (own) {
    return (
      <Link href="/studio/inbox" className={cn(look, "mt-1")}>
        <ChatCircleDotsIcon className="size-3.5 shrink-0" aria-hidden />
        Shoppers&apos; questions arrive in your Studio inbox
      </Link>
    )
  }
  return (
    <button type="button" onClick={() => go(inboxHrefFor(brand))} className={cn(look, "mt-1")}>
      <ChatCircleDotsIcon className="size-3.5 shrink-0" aria-hidden />
      <span>
        Questions? <span className="text-ink">Message {brand.name}</span>
      </span>
    </button>
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
    { label: "Checkout", value: `One payment for every brand in your cart` },
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
            <FooterMessageLink ctx={ctx} />
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
