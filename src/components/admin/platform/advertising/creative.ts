import { countries, type CountryCode } from "@/config/markets"
import { brandById, categoryBySlug, curatedCollections, drops, productById } from "@/lib/data"
import type { Campaign } from "@/lib/data/ads"
import type { CategorySlug, ImageAsset } from "@/lib/data/types"

export type Creative = {
  kind: "brand" | "product" | "drop" | "collection"
  image?: ImageAsset
  title: string
  subtitle: string
  /** Where the creative links to, inside the marketplace. */
  href?: string
}

/** What a campaign shows in its slot, resolved from what it promotes. */
export function resolveCreative(c: Campaign): Creative {
  const brand = brandById.get(c.brandId)
  const brandName = brand?.name ?? "Unknown brand"
  const target = c.targetIds[0] ?? ""
  if (target.startsWith("p_")) {
    const p = productById.get(target)
    if (p) return { kind: "product", image: p.images[0], title: p.name, subtitle: brandName, href: `/products/${p.slug}` }
  }
  if (target.startsWith("d_")) {
    const d = drops.find((x) => x.id === target)
    if (d) return { kind: "drop", image: d.image, title: d.name, subtitle: brandName, href: `/drops/${d.slug}` }
  }
  if (target.startsWith("cc_")) {
    const cc = curatedCollections.find((x) => x.id === target)
    if (cc) return { kind: "collection", image: cc.image, title: cc.name, subtitle: `Sponsored by ${brandName}`, href: `/collections/${cc.slug}` }
  }
  return { kind: "brand", image: brand?.cover, title: brandName, subtitle: brand ? brand.tagline : "", href: brand ? `/brands/${brand.handle}` : undefined }
}

export const creativeKindLabel: Record<Creative["kind"], string> = { brand: "Brand", product: "Product", drop: "Drop", collection: "Collection" }

/** "Streetwear, Sneakers in Nigeria, Ghana" or "Everyone". */
export function audienceLabel(c: Campaign) {
  const cats = c.audience.categories.map((s) => categoryBySlug.get(s as CategorySlug)?.name ?? s)
  const where = c.audience.countries.map((x) => countries[x as CountryCode]?.name ?? x)
  if (!cats.length && !where.length) return "Everyone"
  return [cats.length ? cats.join(", ") : "All categories", where.length ? `in ${where.join(", ")}` : ""].filter(Boolean).join(" ")
}
