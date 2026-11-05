import type { Brand, BrandMark, ImageAsset, StorefrontConfig } from "@/lib/data/types"

/** The brand-level look a storefront document can carry on top of its sections (set in the Studio editor). */
export type StorefrontBrandOverrides = {
  cover?: ImageAsset
  logo?: { kind: "mark"; mark: BrandMark } | { kind: "image"; image: ImageAsset }
  social?: Brand["social"]
}

/**
 * The brand as its storefront shows it: the document's cover, text mark and links when it has
 * them, the brand's own otherwise. The editor preview and the live storefront both use this, so
 * what a merchant previews is exactly what shoppers get after publishing.
 */
export function brandWithStorefront(brand: Brand, config: StorefrontConfig & StorefrontBrandOverrides): Brand {
  return {
    ...brand,
    cover: config.cover ?? brand.cover,
    mark: config.logo?.kind === "mark" ? config.logo.mark : brand.mark,
    social: config.social ?? brand.social,
  }
}
