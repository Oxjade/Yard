"use client"

import { useLayoutEffect, useRef } from "react"
import Image from "next/image"
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react"
import {
  CalendarBlankIcon as CalendarBlank,
  MapPinIcon as MapPin,
  SealCheckIcon as SealCheck,
  SquaresFourIcon as SquaresFour,
  TagIcon as Tag,
  TruckIcon as Truck,
  UsersThreeIcon as UsersThree,
  type Icon,
} from "@phosphor-icons/react"
import { BrandMark } from "@/components/market/brand-mark"
import { Button } from "@/components/ui/button"
import { useHydrated } from "@/hooks/use-hydrated"
import { categoryBySlug } from "@/lib/data/catalog"
import { cn } from "@/lib/utils"
import type { Product, StorefrontAccent, StorefrontSection, StorefrontTemplate } from "@/lib/data/types"
import { Container, FollowAction, ShareAction, SocialLinks, brandFacts, placeOf, type BrandFact, type StorefrontContext } from "../parts"

type HeroProps = {
  ctx: StorefrontContext
  section: StorefrontSection
  intro: string
  products: Product[]
  /** True when the hero is the first thing on the page (no announcement above it). */
  first: boolean
  /** True when the hero is the first section, even with the announcement bar above it. */
  opening?: boolean
  /** In-page anchor for the main call to action, when there is something to shop. */
  shopHref?: string
}

/*
 * Every template opens the same way, like a social profile: the brand's cover as a full-width
 * banner that melts into the page, the round mark overlapping its lower edge like an avatar,
 * then the name and handle with Follow, Share and Shop beside them, the tagline and intro, a
 * quiet line of what and where, and the stats with the brand's links. Templates keep their
 * own headline type and differ in how loud the name is and how the stats sit (under a rule, on
 * a plate, between Street's accent rules); the accent itself is used sparingly (see looks).
 */

/* ---------- Banner ---------- */

/**
 * The banner's height is reserved before the cover loads (it is the page's largest paint) and is
 * the same in every template, so a newly published template never moves the page. Live: about
 * half the window on desktop, 38% on phones. In Brand Studio the editor pane is not the window,
 * so the preview sizes it from the pane's width instead.
 */
const bannerHeight = {
  live: "h-[max(38svh,15rem)] @3xl:h-[clamp(24rem,50svh,38rem)]",
  preview: "h-[clamp(14rem,64cqw,20rem)] @3xl:h-[clamp(20rem,36cqw,30rem)]",
}

/**
 * The melt: obsidian rising through the lower three fifths of the banner on an eased curve, so
 * the photograph dissolves into the page instead of ending on an edge. Around the avatar's top
 * the photograph still shows (so its obsidian ring reads as a cut-out); by the banner's foot,
 * where the name and actions begin, it is solid page colour, so text never sits on the photo.
 */
const melt =
  "linear-gradient(180deg, rgb(8 8 8 / 0) 0%, rgb(8 8 8 / 0.05) 14%, rgb(8 8 8 / 0.16) 28%, rgb(8 8 8 / 0.34) 44%, rgb(8 8 8 / 0.58) 60%, rgb(8 8 8 / 0.8) 75%, rgb(8 8 8 / 0.94) 88%, rgb(8 8 8) 100%)"

/**
 * At the top of the page the floating marketplace header (wordmark, links, search, icons) sits
 * on the cover, so the banner carries its own shade over that band: a fixed height, not a share
 * of the banner, deep enough under the 72px header that its 70% links keep 4.5:1 over a white
 * cover (with the header's own fade), then easing out so the photograph opens up below it.
 */
const headerShade =
  "linear-gradient(180deg, rgb(8 8 8 / 0.9) 0%, rgb(8 8 8 / 0.86) 22%, rgb(8 8 8 / 0.76) 36%, rgb(8 8 8 / 0.52) 54%, rgb(8 8 8 / 0.24) 74%, rgb(8 8 8 / 0.07) 89%, rgb(8 8 8 / 0) 100%)"

/** The cover drifts down at about a third of the scroll and grows a touch while the banner leaves. */
const drift = { y: ["0%", "35%"], scale: [1, 1.06] }

type Placement = "top" | "under-bar" | "inline"

/** The element whose scrolling moves the banner: the preview frame in Brand Studio, else the window. */
function scrollerOf(el: HTMLElement | null) {
  const frame = el?.closest<HTMLElement>("[data-sf-preview]")
  if (frame && /(auto|scroll)/.test(getComputedStyle(frame).overflowY)) return frame
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement
}

/**
 * The cover banner, edge to edge. As the page scrolls, the photograph moves slower than the page
 * (a gentle parallax, transform only) while the melt and everything below scroll normally. The
 * drift runs from the moment the banner's top reaches the top of the view until it has scrolled
 * out, then holds still; it never runs for visitors who ask for reduced motion. In the Brand
 * Studio preview it follows the preview's own scroll, so the merchant sees what shoppers will.
 */
function ProfileBanner({ ctx, placement, treatment, tint }: { ctx: StorefrontContext; placement: Placement; treatment?: string; tint?: string }) {
  const { brand, preview } = ctx
  const ref = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLElement | null>(null)
  const reduce = useReducedMotion()
  // Only after hydration: the server can't know the visitor's motion preference, so the first
  // render is the still banner everywhere and the drift is added once the page is interactive.
  const drifting = useHydrated() && !reduce
  // Runs before useScroll attaches (effects run in order), so it tracks the right scroller.
  useLayoutEffect(() => {
    scroller.current = scrollerOf(ref.current)
  }, [])
  const { scrollYProgress } = useScroll({ target: ref, container: scroller, offset: ["start start", "end start"] })
  const y = useTransform(scrollYProgress, [0, 1], drift.y)
  const scale = useTransform(scrollYProgress, [0, 1], drift.scale)

  return (
    <div
      ref={ref}
      className={cn(
        "relative isolate overflow-hidden bg-card",
        preview ? bannerHeight.preview : bannerHeight.live,
        placement === "under-bar" && "mt-3 @3xl:mt-4",
        placement === "inline" && "mt-24 @3xl:mt-32",
      )}
    >
      {/* No will-change: motion promotes the layer while the values change, and once the banner
          has scrolled out the progress holds at 1, so nothing is written and nothing stays promoted. */}
      <motion.div className="absolute inset-0" style={drifting ? { y, scale } : undefined}>
        <Image
          src={brand.cover.src}
          alt={brand.cover.alt}
          fill
          preload={!preview}
          loading={preview ? "eager" : undefined}
          sizes={preview ? "(min-width: 1024px) 60vw, 100vw" : "100vw"}
          className={cn("object-cover", treatment)}
        />
      </motion.div>
      {tint ? <span aria-hidden className={cn("absolute inset-0", tint)} /> : null}
      {/* Outside the drifting layer, so the shades stay put while the photograph moves. At the top of
          the live page the header band is shaded (see headerShade); the editor preview has no header
          over it, so it only hints at that shade; lower down the banner melts into what's above. */}
      {placement === "top" && !preview ? (
        <span aria-hidden className="absolute inset-x-0 top-0 h-40 @3xl:h-44" style={{ backgroundImage: headerShade }} />
      ) : (
        <span aria-hidden className={cn("absolute inset-x-0 top-0 h-1/4 bg-linear-to-b to-transparent", placement === "top" ? "from-obsidian/45" : "from-obsidian/85")} />
      )}
      <span aria-hidden className="absolute inset-x-0 bottom-0 h-3/5" style={{ backgroundImage: melt }} />
    </div>
  )
}

function placementOf({ first, opening }: Pick<HeroProps, "first" | "opening">): Placement {
  return first ? "top" : opening ? "under-bar" : "inline"
}

/* ---------- Templates ---------- */

type Look = {
  /** Which of the headline type's sizes the name uses. */
  name: "heroSplit" | "profile"
  /** The tagline's size and weight (its colour is ink, or the accent where `accentTagline` allows). */
  tagline: string
  /** The tagline in the brand's accent, unless the accent is acid or violet (see quietAccent). */
  accentTagline?: boolean
  /** How the stats and links sit: under a hairline, on their own, in an accent-ruled bar, or on a plate. */
  stats: "rule" | "plain" | "bar" | "plate"
  /** The avatar mounted on a plate, like a print. */
  plated?: boolean
  /** Treatment of the cover photograph. */
  treatment?: string
  tint?: string
}

/*
 * The accent appears at most once in the header, on one quiet element (Street's rules and, in a
 * colour that isn't the marketplace's own, its tagline). Acid is the Shop button's colour and
 * violet marks what is selected, so neither is spent on decoration next to them; stat icons are
 * always grey. Templates differ in type size, rules and plates instead.
 */
const looks: Record<StorefrontTemplate, Look> = {
  // A masthead: the tagline set as a standfirst, a hairline over the stats.
  editorial: { name: "profile", tagline: "text-xl leading-snug @3xl:text-2xl", stats: "rule" },
  // Quiet: the profile size, nothing ruled.
  minimal: { name: "profile", tagline: "text-base leading-snug @3xl:text-lg", stats: "plain" },
  // Loud: the name as big as the row allows, a desaturated cover, the stats between accent rules.
  street: {
    name: "heroSplit",
    tagline: "text-base font-medium leading-snug @3xl:text-lg",
    accentTagline: true,
    stats: "bar",
    treatment: "grayscale-[0.35]",
    tint: "bg-obsidian/25",
  },
  // A gallery label: the mark plated like a print, the stats on a plate of their own.
  studio: { name: "profile", tagline: "text-lg leading-snug", stats: "plate", plated: true },
}

/** Accents that are the marketplace's own signals (acid for the primary action, violet for selection). */
const quietAccent: Partial<Record<StorefrontAccent, true>> = { acid: true, violet: true }

/* ---------- Profile parts ---------- */

/** Rough advance of each character in a mark, in ems, for each of the mark's styles. */
const markAdvance = { condensed: 0.55, grotesk: 0.68, expanded: 0.9 }
const narrowMarkChars: Record<string, number> = { "/": 0.45, "!": 0.35, ".": 0.3, "'": 0.3, "&": 0.8, "—": 1, "–": 0.6 }

/**
 * Text size for a mark inside the round avatar: as large as the circle comfortably holds, so a
 * single letter fills it and three wide characters ("M—O") still sit inside the ring.
 */
function markFit(mark: StorefrontContext["brand"]["mark"]) {
  const em = [...mark.text].reduce((n, ch) => n + (narrowMarkChars[ch] ?? markAdvance[mark.style] ?? 0.7), 0)
  if (em <= 1.9) return "text-[2rem] @3xl:text-[3.25rem]"
  if (em <= 2.4) return "text-[1.625rem] @3xl:text-[2.625rem]"
  return "text-[1.375rem] @3xl:text-[2.125rem]"
}

/** The brand's mark as a round profile picture, cut out of the banner by a ring of page colour. */
function ProfileAvatar({ ctx, plated, className }: { ctx: StorefrontContext; plated?: boolean; className?: string }) {
  const mark = (
    <BrandMark
      brand={ctx.brand}
      size="xl"
      className={cn(
        "size-24 rounded-full bg-card @3xl:size-36",
        markFit(ctx.brand.mark),
        plated ? "size-[5.25rem] @3xl:size-32" : "ring-[3px] ring-obsidian @3xl:ring-4",
        !plated && className,
      )}
    />
  )
  if (!plated) return mark
  return <span className={cn("inline-flex rounded-full border border-line bg-surface p-1.5 ring-[3px] ring-obsidian @3xl:p-2 @3xl:ring-4", className)}>{mark}</span>
}

/** The name in the template's headline type, with the verified seal after its last word. */
function ProfileName({ ctx, size }: { ctx: StorefrontContext; size: Look["name"] }) {
  const { brand } = ctx
  const Tag = ctx.preview ? "h2" : "h1"
  return (
    <>
      <Tag id="sf-hero-title" className={cn(ctx.type.family, ctx.type[size], "text-balance break-words text-ink")}>
        {brand.name}
        {brand.verified ? (
          <SealCheck weight="fill" aria-hidden className="relative -top-[0.04em] ml-[0.16em] inline-block size-[clamp(1.25rem,0.3em,2rem)] align-middle text-violet" />
        ) : null}
      </Tag>
      {brand.verified ? <span className="sr-only">Verified brand</span> : null}
    </>
  )
}

/** What and where, as a profile's quiet meta line: the brand's category, then its city and country. */
function ProfileMeta({ ctx, className }: { ctx: StorefrontContext; className?: string }) {
  const { brand } = ctx
  const category = categoryBySlug.get(brand.categories[0])?.name
  const items: { key: string; icon: Icon; text: string }[] = [
    ...(category ? [{ key: "category", icon: Tag, text: category }] : []),
    { key: "place", icon: MapPin, text: placeOf(brand) },
  ]
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink-2", className)} aria-label={`About ${brand.name}`}>
      {items.map((m) => (
        <li key={m.key} className="inline-flex items-center gap-1.5">
          <m.icon aria-hidden className="size-4 shrink-0" />
          {m.text}
        </li>
      ))}
    </ul>
  )
}

const statFacts: BrandFact[] = ["followers", "pieces", "founded", "shipsFrom"]
const statIcons: Record<BrandFact, Icon> = { followers: UsersThree, pieces: SquaresFour, founded: CalendarBlank, shipsFrom: Truck }

/**
 * The profile's counts: icon and figure over a small label, split by thin dividers. The label
 * comes first for screen readers ("Followers, 48.2K") and sits under the figure on screen.
 *
 * Where orders ship from is a stat too. On a phone its figure is the country's two-letter code
 * (a country name is too wide for a figure there; screen readers still hear the name), and from
 * a tablet up it is the name. The four sit in one row from a 390px phone up; narrower (or on
 * Studio's plate, which is inset) they make two rows of two rather than leave one alone. Every
 * stat carries its divider on its left, and the stats are pulled left by one gap inside a
 * clipping box, so the stat that starts a row lines up with the text above and its divider is
 * cut away, however the row wraps.
 */
function ProfileStats({ ctx, pieces, onPlate }: { ctx: StorefrontContext; pieces: number; onPlate: boolean }) {
  const facts = brandFacts(ctx.brand, statFacts, { pieces })
  return (
    <div className={cn("w-full overflow-hidden", onPlate ? "@xl:w-auto @xl:max-w-full" : "@min-[24rem]:w-auto @min-[24rem]:max-w-full")}>
      <dl
        className={cn(
          "-ml-[calc(1rem+1px)] grid grid-cols-2 gap-y-5 @xl:-ml-[calc(1.25rem+1px)] @3xl:-ml-[calc(1.75rem+1px)]",
          onPlate ? "@xl:flex @xl:flex-wrap" : "@min-[24rem]:flex @min-[24rem]:flex-wrap",
        )}
      >
        {facts.map((f) => {
          const Glyph = statIcons[f.key]
          return (
            <div key={f.key} className="flex flex-col-reverse justify-end border-l border-line px-4 @xl:px-5 @3xl:px-7">
              <dt className="mt-1.5 text-xs whitespace-nowrap text-ink-2">{f.label}</dt>
              <dd className="flex items-center gap-2 text-lg leading-none font-semibold whitespace-nowrap text-ink tabular @3xl:text-2xl">
                <Glyph aria-hidden className="size-4 shrink-0 text-ink-2 @3xl:size-5" />
                {f.key === "shipsFrom" ? (
                  <>
                    <span aria-hidden className="@xl:hidden">{ctx.brand.shipsFrom}</span>
                    <span className="sr-only @xl:not-sr-only">{f.value}</span>
                  </>
                ) : (
                  f.value
                )}
              </dd>
            </div>
          )
        })}
      </dl>
    </div>
  )
}

/**
 * The storefront's one primary action: go to the products. `short` says just "Shop" on phones,
 * where it fills the rest of the row after Follow and Share; its accessible name always carries
 * the brand.
 */
function ShopAction({ ctx, href, short = false, className }: { ctx: StorefrontContext; href?: string; short?: boolean; className?: string }) {
  if (!href) return null
  const label = `Shop ${ctx.brand.name}`
  return (
    <Button asChild variant="primary" className={className}>
      <a href={href} aria-label={short ? label : undefined}>
        {short ? (
          <>
            <span className="@lg:hidden">Shop</span>
            <span className="hidden @lg:inline">{label}</span>
          </>
        ) : (
          label
        )}
      </a>
    </Button>
  )
}

/** Pills, a touch larger on wide screens. */
const pill = "rounded-full @3xl:h-11 @3xl:px-5"

/* ---------- The hero ---------- */

export function HeroSection({ ctx, intro, products, first, opening, shopHref }: HeroProps) {
  const { brand } = ctx
  const look = looks[ctx.template] ?? looks.editorial
  const statsRow = "flex flex-wrap items-center justify-between gap-x-10 gap-y-5"
  const stats = (
    <>
      <ProfileStats ctx={ctx} pieces={products.length} onPlate={look.stats === "plate"} />
      <SocialLinks brand={brand} />
    </>
  )

  return (
    <section id="sf-hero" aria-labelledby="sf-hero-title" data-section="hero">
      <ProfileBanner ctx={ctx} placement={placementOf({ first, opening })} treatment={look.treatment} tint={look.tint} />

      {/* Two thirds of the avatar overlap the banner's foot. */}
      <Container className="relative z-10 -mt-16 @3xl:-mt-24">
        {/* Phones: the actions get a row of their own under the name (Following is wider than
            Follow, so beside the avatar they'd collide). Wider: on the name's row, at its right. */}
        <div className="grid grid-cols-1 @3xl:grid-cols-[minmax(0,1fr)_auto] @3xl:gap-x-10">
          <ProfileAvatar ctx={ctx} plated={look.plated} className="col-start-1 row-start-1 justify-self-start" />
          <div className="col-start-1 row-start-2 mt-5 min-w-0 @3xl:mt-7">
            <ProfileName ctx={ctx} size={look.name} />
            <p className="mt-2 text-sm text-ink-2 @3xl:mt-3 @3xl:text-[0.9375rem]">@{brand.handle}</p>
          </div>
          <div className="col-start-1 row-start-3 mt-5 flex items-center gap-2 @3xl:col-start-2 @3xl:row-start-2 @3xl:mt-0 @3xl:self-center @3xl:pt-7">
            <FollowAction ctx={ctx} className={pill} />
            <ShareAction ctx={ctx} className="@3xl:size-11" />
            <ShopAction ctx={ctx} href={shopHref} short className={cn(pill, "min-w-0 flex-1 @lg:flex-none")} />
          </div>
        </div>

        <div className="mt-6 max-w-2xl">
          <p className={cn("text-pretty", look.tagline, look.accentTagline && !quietAccent[ctx.accent] ? "text-(color:--sf-accent)" : "text-ink")}>{brand.tagline}</p>
          {intro ? <p className="mt-2.5 text-pretty text-[0.9375rem] leading-relaxed text-ink-2">{intro}</p> : null}
        </div>
        <ProfileMeta ctx={ctx} className="mt-5" />

        {look.stats === "bar" ? null : (
          <div
            className={cn(
              statsRow,
              "mt-8 @3xl:mt-10",
              look.stats === "rule" && "border-t border-line-soft pt-7",
              look.stats === "plate" && "rounded-2xl border border-line-soft bg-card p-5 @3xl:px-7 @3xl:py-6",
            )}
          >
            {stats}
          </div>
        )}
      </Container>

      {look.stats === "bar" ? (
        <div className="mt-8 border-y-2 border-(color:--sf-accent) @3xl:mt-10">
          <Container className={cn(statsRow, "py-5")}>{stats}</Container>
        </div>
      ) : null}
    </section>
  )
}
