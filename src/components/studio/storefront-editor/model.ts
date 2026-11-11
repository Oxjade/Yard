import type { Brand, BrandMark, Collection, Drop, ImageAsset, Product, Story, StorefrontConfig, StorefrontSection, StorefrontSectionType } from "@/lib/data/types"
import { storefrontSections } from "@/components/storefront/theme"
import { brandWithStorefront } from "@/components/storefront/brand-with-storefront"
import { site } from "@/config/site"

/**
 * The storefront editor's model. The draft is a StorefrontConfig kept in the Studio store;
 * the editor adds the brand-level look it also edits (cover, logo, social links) as optional
 * fields on the same document, so save, discard and publish move them together. The live
 * storefront renders the published brand with them (brandWithStorefront).
 */

export type LogoChoice = { kind: "mark"; mark: BrandMark } | { kind: "image"; image: ImageAsset }
export type SocialLinks = Brand["social"]

export type EditorConfig = StorefrontConfig & {
  /** Cover photograph shown in the hero. Absent: the brand's own cover. */
  cover?: ImageAsset
  /** Absent: the brand's own text mark. */
  logo?: LogoChoice
  /** Absent: the brand's own links. */
  social?: SocialLinks
}

export const INTRO_MAX = 280
export const ANNOUNCEMENT_MAX = 100
export const HEADING_MAX = 40
export const FEATURED_MAX = 8
export const COLLECTIONS_MAX = 12
export const MARK_MAX = 3
/** Most posts a Social feed section shows, and most it can pin (§6.1). */
export const SOCIAL_MAX = 12
export const SOCIAL_MIN = 3

/** Every section type, in the order a fresh storefront lists them. */
export const SECTION_TYPES = Object.keys(storefrontSections) as StorefrontSectionType[]

/** How many pieces the featured section picks by itself in each template (mirrors the renderer). */
export function autoFeaturedCount(template: StorefrontConfig["template"]) {
  return template === "editorial" ? 5 : template === "studio" ? 3 : 4
}

/* ---------- Normalising ---------- */

const sameSocial = (a: SocialLinks, b: SocialLinks) =>
  (["instagram", "tiktok", "x", "website"] as const).every((k) => (a[k] ?? "") === (b[k] ?? ""))

/**
 * One canonical shape: the hero first, every section type listed once (missing ones hidden at
 * the end), empty optional fields dropped, and brand-level values that equal the brand's own
 * removed. Two configs that render the same normalise to the same document.
 */
export function normalize(config: EditorConfig, brand: Brand): EditorConfig {
  const seen = new Set<StorefrontSectionType>()
  const sections: StorefrontSection[] = []
  for (const s of config.sections) {
    if (seen.has(s.type) || !storefrontSections[s.type]) continue
    seen.add(s.type)
    const next: StorefrontSection = { id: s.id || s.type, type: s.type, enabled: !!s.enabled }
    if (s.title?.trim()) next.title = s.title
    if (s.productIds?.length) next.productIds = s.productIds
    if (s.collectionIds?.length) next.collectionIds = s.collectionIds
    // The Social feed's settings and pinned posts (§6.1): kept, or every edit would strip them.
    if (s.feed) next.feed = { source: s.feed.source, layout: s.feed.layout, count: s.feed.count }
    if (s.postIds?.length) next.postIds = s.postIds.slice(0, SOCIAL_MAX)
    sections.push(next)
  }
  for (const type of SECTION_TYPES) if (!seen.has(type)) sections.push({ id: type, type, enabled: false })
  const heroAt = sections.findIndex((s) => s.type === "hero")
  if (heroAt > 0) sections.unshift(...sections.splice(heroAt, 1))

  const out: EditorConfig = {
    template: config.template,
    accent: config.accent,
    typePreset: config.typePreset,
    intro: config.intro ?? "",
    announcement: config.announcement ? { text: config.announcement.text, ...(config.announcement.href ? { href: config.announcement.href } : {}) } : null,
    sections,
  }
  if (config.cover && config.cover.src !== brand.cover.src) out.cover = config.cover
  if (config.logo?.kind === "image") out.logo = config.logo
  else if (config.logo?.kind === "mark" && (config.logo.mark.text !== brand.mark.text || config.logo.mark.style !== brand.mark.style)) out.logo = config.logo
  if (config.social && !sameSocial(config.social, brand.social)) {
    const social: SocialLinks = {}
    for (const k of ["instagram", "tiktok", "x", "website"] as const) if (config.social[k]) social[k] = config.social[k]
    out.social = social
  }
  return out
}

/** Stable serialisation (sorted keys) for comparing documents. */
export function fingerprint(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]])) : v,
  )
}

/** The brand as the storefront shows it with this draft's cover, mark and links (the live storefront uses the same mapping). */
export function brandForPreview(brand: Brand, config: EditorConfig): Brand {
  return brandWithStorefront(brand, config)
}

/* ---------- Photo library ---------- */

/** The brand's own photography, de-duplicated: cover, collections, drops, stories, then products. */
export function brandPhotos(brand: Brand, products: Product[], collections: Collection[], drops: Drop[], stories: Story[]): ImageAsset[] {
  const seen = new Set<string>()
  const out: ImageAsset[] = []
  const push = (image?: ImageAsset) => {
    if (!image || seen.has(image.src) || image.src.startsWith("data:") || image.src.startsWith("blob:")) return
    seen.add(image.src)
    out.push(image)
  }
  push(brand.cover)
  collections.forEach((c) => push(c.image))
  drops.forEach((d) => push(d.image))
  stories.forEach((s) => push(s.cover))
  products.forEach((p) => p.images.forEach(push))
  return out
}

export const isUpload = (image?: ImageAsset) => !!image && (image.mediaId !== undefined || image.src.startsWith("data:") || image.src.startsWith("blob:"))

/* ---------- Validation (on publish) ---------- */

export type FieldErrors = Partial<Record<FieldKey, string>>
export type FieldKey = "intro" | "announcement-text" | "announcement-href" | "cover-alt" | "mark-text" | "instagram" | "tiktok" | "x" | "website" | "sections"

/** Which control panel tab holds each field, so a failed publish can take the brand there. */
export const fieldTab: Record<FieldKey, "design" | "content" | "sections"> = {
  intro: "content",
  "announcement-text": "content",
  "announcement-href": "content",
  "cover-alt": "content",
  "mark-text": "content",
  instagram: "content",
  tiktok: "content",
  x: "content",
  website: "content",
  sections: "sections",
}

/** The DOM id of each field's control, for focusing the first error. */
export const fieldControlId: Record<FieldKey, string> = {
  intro: "sf-intro",
  "announcement-text": "sf-announcement-text",
  "announcement-href": "sf-announcement-href",
  "cover-alt": "sf-cover-alt",
  "mark-text": "sf-mark-text",
  instagram: "sf-social-instagram",
  tiktok: "sf-social-tiktok",
  x: "sf-social-x",
  website: "sf-social-website",
  // The hero's switch: the list always starts with the hero, and a switch can say it's invalid.
  sections: "sf-sections-switch",
}

const handlePattern: Record<"instagram" | "tiktok" | "x", { re: RegExp; message: string }> = {
  instagram: { re: /^(?!.*\.\.)(?!\.)[A-Za-z0-9._]{1,30}(?<!\.)$/, message: "Use letters, numbers, full stops and underscores, up to 30 characters." },
  tiktok: { re: /^(?!.*\.$)[A-Za-z0-9._]{2,24}$/, message: "Use 2 to 24 letters, numbers, full stops and underscores." },
  x: { re: /^[A-Za-z0-9_]{1,15}$/, message: "Use up to 15 letters, numbers and underscores." },
}

const websitePattern = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(:\d{2,5})?(\/[^\s]*)?$/i

/** Strips what people paste around a handle: @, a full profile URL, spaces. */
export function cleanHandle(network: "instagram" | "tiktok" | "x", raw: string) {
  let v = raw.trim()
  const hosts = { instagram: /^(https?:\/\/)?(www\.)?instagram\.com\//i, tiktok: /^(https?:\/\/)?(www\.)?tiktok\.com\/@?/i, x: /^(https?:\/\/)?(www\.)?(x|twitter)\.com\//i }
  v = v.replace(hosts[network], "").replace(/^@/, "").replace(/[/?#].*$/, "")
  return v
}

/** The renderer links to https://<website>, so keep the address without its scheme. */
export function cleanWebsite(raw: string) {
  return raw.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "")
}

/** Announcement links: a page on the marketplace (/drops). Matches the server's rule for config.announcement.href. */
export function linkError(href: string) {
  const v = href.trim()
  if (!v) return undefined
  if (/^https?:\/\//i.test(v)) return `Links must stay on ${site.name}. Use a path that starts with /, like /drops.`
  if (!v.startsWith("/")) return "Start the link with /, like /drops."
  return /^\/(?![/\\])[\w\-./?=&%#]*$/.test(v) ? undefined : "Use a path with letters, numbers and / only, like /drops."
}

export function validate(config: EditorConfig, brand: Brand): FieldErrors {
  const errors: FieldErrors = {}
  if (config.intro.length > INTRO_MAX) errors.intro = `Keep it to ${INTRO_MAX} characters. It's ${config.intro.length} now.`
  if (config.announcement) {
    const text = config.announcement.text.trim()
    if (!text) errors["announcement-text"] = "Write the announcement, or turn the bar off."
    else if (text.length > ANNOUNCEMENT_MAX) errors["announcement-text"] = `Keep it to ${ANNOUNCEMENT_MAX} characters.`
    const href = linkError(config.announcement.href ?? "")
    if (href) errors["announcement-href"] = href
  }
  if (config.cover && isUpload(config.cover) && config.cover.alt.trim().length < 3) errors["cover-alt"] = "Describe the photo for people using screen readers."
  if (config.logo?.kind === "mark") {
    const t = config.logo.mark.text.trim()
    if (!t) errors["mark-text"] = "Add one to three characters for your mark."
    else if (t.length > MARK_MAX) errors["mark-text"] = `Use at most ${MARK_MAX} characters.`
  }
  const social = config.social ?? brand.social
  for (const k of ["instagram", "tiktok", "x"] as const) {
    const v = social[k]
    if (v && !handlePattern[k].re.test(v)) errors[k] = handlePattern[k].message
  }
  if (social.website && !websitePattern.test(social.website)) errors.website = "Enter a web address, like yourbrand.com."
  if (!config.sections.some((s) => s.enabled)) errors.sections = "Turn on at least one section so your storefront has something to show."
  const feed = config.sections.find((s) => s.type === "social-feed")?.feed
  if (!errors.sections && feed && (!Number.isInteger(feed.count) || feed.count < SOCIAL_MIN || feed.count > SOCIAL_MAX)) errors.sections = `The Social feed shows ${SOCIAL_MIN} to ${SOCIAL_MAX} posts.`
  return errors
}

/** Plain-language list of what changed between the live version and the draft, for the publish toast. */
export function changeSummary(draft: EditorConfig, live: EditorConfig): string[] {
  const out: string[] = []
  if (draft.template !== live.template) out.push("template")
  if (draft.accent !== live.accent) out.push("colour")
  if (draft.typePreset !== live.typePreset) out.push("type")
  if (draft.intro !== live.intro) out.push("introduction")
  if (fingerprint(draft.announcement) !== fingerprint(live.announcement)) out.push("announcement")
  if (fingerprint(draft.sections) !== fingerprint(live.sections)) out.push("sections")
  if (fingerprint(draft.cover) !== fingerprint(live.cover)) out.push("cover")
  if (fingerprint(draft.logo) !== fingerprint(live.logo)) out.push("logo")
  if (fingerprint(draft.social) !== fingerprint(live.social)) out.push("social links")
  return out
}
