import type { CSSProperties } from "react"
import type {
  Brand,
  Collection,
  ImageAsset,
  Product,
  StorefrontAccent,
  StorefrontConfig,
  StorefrontSection,
  StorefrontSectionType,
  StorefrontTemplate,
  StorefrontTypePreset,
} from "@/lib/data/types"

/**
 * Storefront theming: the constrained set of choices a brand can make (template, accent,
 * headline type). Everything here is plain data so Brand Studio's editor can list the
 * options and the renderer can apply them, on the server or the client.
 */

/* ---------- Accents ---------- */

export type AccentTokens = {
  label: string
  /** Accent used for text, rules and fills. A theme token where the palette has one. */
  value: string
  /** A quiet tint of the accent for hover and selected backgrounds. */
  soft: string
  /** Text colour on an accent fill. */
  on: string
  /** WCAG contrast of `value` as text on obsidian (#080808). */
  contrast: number
}

/**
 * Brands pick from this curated set instead of a free colour picker, so contrast always
 * holds on obsidian. Violet, acid and ink are the marketplace's own tokens, so a storefront
 * in acid is the same acid as the Shop button and the Sale badge beside it. Ember, aqua and
 * rose exist only for storefronts (StorefrontAccent in the data layer), so they are literal.
 *
 * Contrast against the current surfaces (obsidian #080808, surface #0f0f0f, card #131313,
 * elevated #1b1b1b), and obsidian text on each accent fill matches the first figure:
 *   violet  4.68 obsidian, 4.48 surface, 4.34 card, 4.03 elevated (the same as text-violet
 *           everywhere else in the project: AA for large text and UI, body text on obsidian)
 *   acid   18.30 obsidian, 15.74 elevated
 *   ink    18.37 obsidian, 15.80 elevated
 *   ember   8.58 obsidian,  7.38 elevated
 *   aqua   12.55 obsidian, 10.80 elevated
 *   rose    9.35 obsidian,  8.04 elevated
 */
const tint = (token: string, percent: number) => `color-mix(in oklab, var(${token}) ${percent}%, transparent)`

export const storefrontAccents: Record<StorefrontAccent, AccentTokens> = {
  violet: { label: "Violet", value: "var(--color-violet)", soft: tint("--color-violet", 14), on: "var(--color-obsidian)", contrast: 4.68 },
  acid: { label: "Acid", value: "var(--color-acid)", soft: tint("--color-acid", 12), on: "var(--color-obsidian)", contrast: 18.3 },
  ink: { label: "Ink", value: "var(--color-ink)", soft: tint("--color-ink", 10), on: "var(--color-obsidian)", contrast: 18.37 },
  ember: { label: "Ember", value: "#ff8a4c", soft: "rgba(255, 138, 76, 0.14)", on: "var(--color-obsidian)", contrast: 8.58 },
  aqua: { label: "Aqua", value: "#4fe3c9", soft: "rgba(79, 227, 201, 0.13)", on: "var(--color-obsidian)", contrast: 12.55 },
  rose: { label: "Rose", value: "#ff8dbe", soft: "rgba(255, 141, 190, 0.14)", on: "var(--color-obsidian)", contrast: 9.35 },
}

/** CSS variables consumed by the storefront's classes (text-(color:--sf-accent) and friends). */
export function accentStyle(accent: StorefrontAccent): CSSProperties {
  const a = storefrontAccents[accent] ?? storefrontAccents.violet
  return { "--sf-accent": a.value, "--sf-accent-soft": a.soft, "--sf-on-accent": a.on } as CSSProperties
}

/* ---------- Headline type ---------- */

export type TypeTokens = {
  label: string
  description: string
  /** Family, weight, case and tracking. */
  family: string
  /**
   * The largest display size: collection titles, and Street's brand name beside its actions.
   * Sizes use container units so drafts render correctly in an editor pane.
   */
  heroSplit: string
  /** The brand name in the storefront's profile header, beside the Follow, Share and Shop actions. */
  profile: string
  /** Section headings. */
  heading: string
  /** Card and tile titles. */
  title: string
}

export const storefrontType: Record<StorefrontTypePreset, TypeTokens> = {
  condensed: {
    label: "Condensed",
    description: "Tall, narrow capitals. Loud at any size.",
    family: "font-display",
    heroSplit: "text-[clamp(3.25rem,9cqw,8rem)] leading-[0.84]",
    profile: "text-[clamp(2.75rem,6.4cqw,5.5rem)] leading-[0.86]",
    heading: "text-[clamp(2.25rem,5.6cqw,4.25rem)] leading-[0.88]",
    title: "text-[clamp(1.625rem,3cqw,2.5rem)] leading-[0.9]",
  },
  grotesk: {
    label: "Grotesk",
    description: "Bold sentence case. Direct and modern.",
    family: "font-sans font-bold tracking-[-0.045em]",
    heroSplit: "text-[clamp(2.5rem,5.6cqw,5.25rem)] leading-[0.92]",
    profile: "text-[clamp(2.25rem,4.4cqw,3.75rem)] leading-[0.95]",
    heading: "text-[clamp(1.875rem,3.8cqw,3rem)] leading-[0.98]",
    title: "text-[clamp(1.25rem,2.2cqw,1.75rem)] leading-[1.05]",
  },
  expanded: {
    label: "Expanded",
    description: "Wide capitals with a lot of presence.",
    family: "font-display font-stretch-expanded font-bold tracking-[0.01em]",
    heroSplit: "text-[clamp(1.875rem,4cqw,3.75rem)] leading-[0.96]",
    profile: "text-[clamp(1.75rem,3.4cqw,3rem)] leading-[1]",
    heading: "text-[clamp(1.5rem,3cqw,2.5rem)] leading-[1]",
    title: "text-[clamp(1.125rem,1.8cqw,1.5rem)] leading-[1.05]",
  },
}

/* ---------- Templates and sections (for the editor and the renderer) ---------- */

export const storefrontTemplates: Record<StorefrontTemplate, { label: string; description: string }> = {
  editorial: { label: "Editorial", description: "Your tagline as a standfirst, numbered sections and magazine spreads." },
  minimal: { label: "Minimal", description: "Whitespace and a quiet grid. The product does the talking." },
  street: { label: "Street", description: "Heavy type, an accent-ruled stats bar and drops up front." },
  studio: { label: "Studio", description: "A gallery for objects and editions, with plated images and numbered pieces." },
}

export const storefrontSections: Record<StorefrontSectionType, { label: string; description: string; defaultTitle: string }> = {
  hero: { label: "Hero", description: "Cover banner, mark, name, tagline, location, stats and links.", defaultTitle: "Hero" },
  "featured-products": { label: "Featured products", description: "A short edit of pieces you choose, or your first four.", defaultTitle: "Featured" },
  collections: { label: "Collections", description: "Your collections as image tiles.", defaultTitle: "Collections" },
  drops: { label: "Drops", description: "Live, upcoming and past releases.", defaultTitle: "Drops" },
  story: { label: "Story", description: "Your story, your founder and your journal.", defaultTitle: "The story" },
  lookbook: { label: "Lookbook", description: "An editorial spread built from your product photography.", defaultTitle: "Lookbook" },
  "all-products": { label: "All products", description: "Every published piece, with a category filter.", defaultTitle: "Shop all" },
}

export function sectionTitle(section: StorefrontSection) {
  return section.title?.trim() || storefrontSections[section.type].defaultTitle
}

/* ---------- Data resolution (pure) ---------- */

export function resolveFeatured(section: StorefrontSection, products: Product[], count: number) {
  if (section.productIds?.length) {
    const byId = new Map(products.map((p) => [p.id, p]))
    return section.productIds.map((id) => byId.get(id)).filter((p): p is Product => !!p)
  }
  // Inside a storefront the brand's own order is kept.
  return products.slice(0, count)
}

export function resolveCollections(section: StorefrontSection, collections: Collection[]) {
  if (section.collectionIds?.length) {
    const byId = new Map(collections.map((c) => [c.id, c]))
    return section.collectionIds.map((id) => byId.get(id)).filter((c): c is Collection => !!c)
  }
  return collections
}

/** The first section of this type that is switched on. */
function enabledSection(config: StorefrontConfig, type: StorefrontSectionType) {
  return config.sections.find((s) => s.enabled && s.type === type)
}

/** Anchor of the compact collections index the renderer adds when the section is off. */
export const collectionIndexId = "sf-collection-index"

/**
 * Where a storefront lists its collections: the collections section when it is on and shows
 * any, otherwise a short index under the hero (templates such as Street leave the section
 * out). Null when the brand has no collections. Collection pages link back to this anchor.
 */
export function collectionsAnchorId(config: StorefrontConfig, collections: Collection[]) {
  if (!collections.length) return null
  const section = enabledSection(config, "collections")
  if (section && resolveCollections(section, collections).length) return `sf-${section.id}`
  return collectionIndexId
}

export function saleProducts(products: Product[]) {
  return products.filter((p) => p.compareAt !== undefined && p.compareAt > p.price)
}

/** A lookbook photograph and, when we know what it shows, where tapping it goes. */
export type LookbookFrame = { image: ImageAsset; link?: { href: string; label: string; kind: "piece" | "release" } }

/** A drop or collection photograph: the brand shot it for that release, so it links there. */
export type LookbookRelease = { image: ImageAsset; href: string; label: string }

/**
 * The brand's photography for its lookbook, de-duplicated, never claiming a photograph shows a
 * piece it may not:
 *
 * 1. Each piece's extra photographs. One that also fronts a drop or collection (`releases`) is
 *    that release's campaign shot, so it links to the release under the release's name rather
 *    than to the piece that happens to list it; the others are the piece's own detail shots.
 * 2. Main product photographs to fill the spread, pieces the page doesn't already show above
 *    (`shownAbove`: lists such as the featured edit, then the sale strip, most prominent first)
 *    first, so the lookbook repeats the product grid as little as it can.
 * 3. The brand cover, which links to no piece, only in the last frame, and when the hero already
 *    shows it (`coverInHero`), only if the lookbook would otherwise fall short of `minimum`.
 */
export function lookbookFrames(
  brand: Brand,
  products: Product[],
  count: number,
  {
    coverInHero = false,
    minimum = 3,
    releases = [],
    shownAbove = [],
  }: { coverInHero?: boolean; minimum?: number; releases?: LookbookRelease[]; shownAbove?: string[][] } = {},
): LookbookFrame[] {
  const seen = new Set<string>()
  const frames: LookbookFrame[] = []
  const push = (image: ImageAsset, link?: LookbookFrame["link"]) => {
    if (seen.has(image.src) || frames.length >= count) return
    seen.add(image.src)
    frames.push({ image, link })
  }
  const productLink = (p: Product) => ({ href: `/products/${p.slug}`, label: p.name, kind: "piece" as const })
  const releaseBySrc = new Map<string, LookbookRelease>()
  for (const r of releases) if (!releaseBySrc.has(r.image.src)) releaseBySrc.set(r.image.src, r)

  for (const p of products) {
    for (const image of p.images.slice(1)) {
      const release = releaseBySrc.get(image.src)
      // A release frame takes the release's own description of the photograph, not the piece's.
      if (release) push(release.image, { href: release.href, label: release.label, kind: "release" })
      else push(image, productLink(p))
    }
  }
  // How prominently a piece already appears above the lookbook (`shownAbove` lists the most
  // prominent first, so the featured edit outweighs the sale strip); the least shown fill first.
  const shown = (p: Product) => shownAbove.reduce((n, ids, i) => n + (ids.includes(p.id) ? shownAbove.length - i : 0), 0)
  const byShown = products.map((p, i) => ({ p, i, n: shown(p) })).sort((a, b) => a.n - b.n || a.i - b.i)
  for (const { p } of byShown) push(p.images[0], productLink(p))
  if (!coverInHero || frames.length < minimum) push(brand.cover)
  return frames
}

export function isStorefrontEmpty(config: StorefrontConfig) {
  return !config.sections.some((s) => s.enabled)
}
