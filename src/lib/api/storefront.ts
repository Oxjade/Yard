import { api } from "@/lib/api/client"
import type { CountryCode, CurrencyCode } from "@/config/markets"
import type { Brand, BrandMark, Collection, Drop, ImageAsset, Product, StorefrontConfig } from "@/lib/data/types"
import { toCatalogProduct, type PublicCatalogProduct } from "@/lib/api/catalog-products"

export type StorefrontConfigDto = StorefrontConfig & {
  coverMediaId?: string | null
  coverAlt?: string | null
  coverPath?: string | null
  mark?: BrandMark
  social?: Brand["social"]
}

export type StorefrontDraftDto = {
  config: StorefrontConfigDto
  revision: number
  baseVersion: number
  updatedAt: string
  updatedBy: string
  behindLive: boolean
}

export type StorefrontVersionDto = {
  version: number
  config: StorefrontConfigDto
  publishedAt: string
  note: string | null
  publishedBy?: string
}

export type StudioStorefrontDto = {
  draft: StorefrontDraftDto
  live: { version: number; config: StorefrontConfigDto; publishedAt: string } | null
  versions: Omit<StorefrontVersionDto, "config" | "publishedBy">[]
  underReview: boolean
}

export type StorefrontVersionResponse = StorefrontVersionDto

export type PublicStorefrontDto = {
  brand: {
    id: string
    handle: string
    name: string
    city: string
    citySlug: string
    country: string
    currency: string
    categories: string[]
    verified: boolean
    reviewStatus: string
    joinedAt: string | null
    followersBase: number
    timeZone: string
  }
  storefront: { version: number; publishedAt: string; config: StorefrontConfigDto } | null
  collections: {
    id: string
    handle: string
    name: string
    description: string
    imageSrc: string | null
    imageMediaId: string | null
    productIds: string[]
  }[]
}

type PublicDropDto = {
  id: string
  slug: string
  brand: { id: string; handle: string | null; name: string | null }
  name: string
  description: string
  image: string | null
  access: string
  startsAt: string
  endsAt: string
  totalUnits: number
  limitPerCustomer: number
  productIds: string[]
  sponsored: boolean
}

export type StorefrontEditorContext = {
  studio: StudioStorefrontDto
  published: PublicStorefrontDto
  products: Product[]
  collections: Collection[]
  drops: Drop[]
}

export function storefrontConfigFromDto(dto: StorefrontConfigDto | null): StorefrontConfig {
  if (!dto) {
    return {
      template: "editorial",
      accent: "ink",
      typePreset: "grotesk",
      intro: "",
      sections: [],
    }
  }
  const { coverMediaId: _mediaId, coverAlt: _alt, coverPath: _path, mark: _mark, social: _social, ...config } = dto
  return config
}

export function storefrontDropsFromApi(items: PublicDropDto[], products: Product[]): Drop[] {
  const productsById = new Map(products.map((product) => [product.id, product]))
  return items.map((drop) => {
    const fallbackImage = drop.productIds.flatMap((id) => productsById.get(id)?.images ?? [])[0]
    const imageSrc = drop.image
      ? drop.image.startsWith("/media/")
        ? drop.image
        : `/api/media/${encodeURIComponent(drop.image)}`
      : fallbackImage?.src ?? "/media/missing.svg"
    const access: Drop["access"] = drop.access === "draw" ? "draw" : drop.access === "early_access" ? "early-access" : "first-come"
    return {
      id: drop.id,
      slug: drop.slug,
      brandId: drop.brand.id,
      name: drop.name,
      description: drop.description,
      image: { src: imageSrc, alt: drop.name, width: 1200, height: 900 },
      productIds: drop.productIds,
      releaseOffsetHours: (Date.parse(drop.startsAt) - Date.now()) / 3_600_000,
      durationHours: Math.max(1, (Date.parse(drop.endsAt) - Date.parse(drop.startsAt)) / 3_600_000),
      access,
      limitPerCustomer: drop.limitPerCustomer,
      totalUnits: drop.totalUnits,
      unitsLeft: drop.totalUnits,
      sponsored: drop.sponsored,
    }
  })
}

export function getStudioStorefront(signal?: AbortSignal) {
  return api<StudioStorefrontDto>("/api/studio/storefront", { signal })
}

export function saveStudioStorefrontDraft(config: StorefrontConfigDto, baseRevision: number, options?: { signal?: AbortSignal; keepalive?: boolean }) {
  return api<{ draft: StorefrontDraftDto }>("/api/studio/storefront/draft", {
    method: "PUT",
    body: { config, baseRevision },
    signal: options?.signal,
    keepalive: options?.keepalive,
  })
}

export function publishStudioStorefront(draftRevision: number, expectedVersion: number, signal?: AbortSignal) {
  return api<{ version: number; publishedAt: string }>("/api/studio/storefront/publish", {
    body: { draftRevision, expectedVersion },
    signal,
  })
}

export function getStudioStorefrontVersion(version: number, signal?: AbortSignal) {
  return api<StorefrontVersionResponse>(`/api/studio/storefront/versions/${version}`, { signal })
}

export function restoreStudioStorefrontVersion(version: number, baseRevision: number, signal?: AbortSignal) {
  return api<{ draft: StorefrontDraftDto }>(`/api/studio/storefront/versions/${version}/restore`, {
    body: { baseRevision },
    signal,
  })
}

export async function loadStorefrontEditorContext(handle: string, brandId: string): Promise<StorefrontEditorContext> {
  const [studio, published, productPage, dropPage] = await Promise.all([
    getStudioStorefront(),
    api<PublicStorefrontDto>(`/api/catalog/storefronts/${encodeURIComponent(handle)}`),
    api<{ products: PublicCatalogProduct[] }>(`/api/catalog/products?brand=${encodeURIComponent(brandId)}&limit=60&offset=0`),
    api<{ items: PublicDropDto[] }>(`/api/drops?phase=all&brandId=${encodeURIComponent(brandId)}&limit=50`),
  ])
  const products = productPage.products.map(toCatalogProduct)
  const collections = published.collections.map((collection) => ({
    id: collection.id,
    brandId,
    handle: collection.handle,
    name: collection.name,
    description: collection.description,
    image: {
      src: collection.imageSrc ?? "/media/missing.svg",
      alt: collection.name,
      width: 1200,
      height: 900,
      ...(collection.imageMediaId ? { mediaId: collection.imageMediaId } : {}),
    },
    productIds: collection.productIds,
    status: "published" as const,
  }))
  const drops = storefrontDropsFromApi(dropPage.items, products)
  return { studio, published, products, collections, drops }
}

export function storefrontBrandFromApi(
  profile: PublicStorefrontDto["brand"],
  config: StorefrontConfigDto | null,
  products: Product[],
  audience: "brand" | "public" = "public",
): Brand {
  const coverSrc = config?.coverMediaId
    ? `/api/media/${encodeURIComponent(config.coverMediaId)}${audience === "brand" ? "?as=brand" : ""}`
    : config?.coverPath ?? products[0]?.images[0]?.src ?? "/media/missing.svg"
  const cover: ImageAsset = {
    src: coverSrc,
    alt: config?.coverAlt ?? profile.name,
    width: 1600,
    height: 700,
    ...(config?.coverMediaId ? { mediaId: config.coverMediaId } : {}),
  }
  const country = profile.country as CountryCode
  const currency = profile.currency as CurrencyCode
  const joinedAt = profile.joinedAt ?? new Date().toISOString().slice(0, 10)
  return {
    id: profile.id,
    handle: profile.handle,
    name: profile.name,
    tagline: `${profile.name} on Yard`,
    description: "",
    story: [],
    mark: config?.mark ?? { text: profile.name.slice(0, 2).toUpperCase(), style: "condensed" },
    cover,
    country,
    city: profile.city,
    currency,
    categories: profile.categories as Brand["categories"],
    aesthetics: ["contemporary"],
    founded: Number(joinedAt.slice(0, 4)) || new Date().getFullYear(),
    founder: { name: profile.name, role: "Independent brand" },
    followers: profile.followersBase,
    followerGrowth30d: 0,
    verified: profile.verified,
    joinedAt,
    social: config?.social ?? {},
    storefront: storefrontConfigFromDto(config),
    shipsFrom: country,
    processingDays: [2, 5],
    returnsDays: 14,
  }
}

export type StorefrontEditorConfig = StorefrontConfig & {
  cover?: ImageAsset
  logo?: { kind: "mark"; mark: BrandMark } | { kind: "image"; image: ImageAsset }
  social?: Brand["social"]
}

export function editorConfigFromDto(dto: StorefrontConfigDto, brand: Brand): StorefrontEditorConfig {
  const { coverMediaId, coverAlt, coverPath, mark, social, ...base } = dto
  const coverSrc = coverMediaId ? `/api/media/${encodeURIComponent(coverMediaId)}?as=brand` : coverPath
  return {
    ...base,
    ...(coverSrc ? {
      cover: {
        src: coverSrc,
        alt: coverAlt ?? brand.name,
        width: 1600,
        height: 700,
        ...(coverMediaId ? { mediaId: coverMediaId } : {}),
      },
    } : {}),
    ...(mark ? { logo: { kind: "mark" as const, mark } } : {}),
    ...(social ? { social } : {}),
  }
}

export function editorConfigToDto(config: StorefrontEditorConfig, brand: Brand): StorefrontConfigDto {
  const cover = config.cover
  const { cover: _cover, logo, social, ...base } = config
  const coverMediaId = cover?.mediaId ?? null
  const coverPath = cover && !cover.mediaId && cover.src.startsWith("/media/") && cover.src !== brand.cover.src ? cover.src : null
  return {
    ...base,
    coverMediaId,
    coverAlt: cover?.alt ?? null,
    coverPath,
    mark: logo?.kind === "mark" ? logo.mark : brand.mark,
    social: social ?? brand.social,
  }
}
