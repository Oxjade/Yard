/**
 * GET /api/catalog/brands: the listed brands on the server (never the bundled sample brands), the
 * one brand list production pages read (/brands, "Brands in …", "Brands like this", the Following
 * suggestions, the welcome flow). Pure types and a fetcher, safe on both sides.
 */
export type PublicBrandCard = {
  id: string
  handle: string
  name: string
  city: string
  country: string
  categories: string[]
  /** About 160 characters of the story, or null. */
  story: string | null
  logoSrc: string | null
  coverSrc: string | null
  verified: boolean
  founding: boolean
  foundingBadge: boolean
  /** False while a founding brand isn't selling yet ("Opening soon"). */
  forSale: boolean
  /** When the brand went public (founding: storefront launch; others: joined). */
  listedAt: string | null
}

export type PublicBrandsPage = { brands: PublicBrandCard[]; total: number; nextOffset: number | null }

export type PublicBrandsParams = { q?: string; category?: string; country?: string; founding?: "1" | "0"; exclude?: string; sort?: "name" | "new"; limit?: number; offset?: number }

export async function fetchPublicBrands(params: PublicBrandsParams = {}, init?: RequestInit): Promise<PublicBrandsPage> {
  const query = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") query.set(k, String(v))
  const res = await fetch(`/api/catalog/brands?${query}`, { credentials: "same-origin", ...init })
  if (!res.ok) throw new Error("Brands couldn't be loaded.")
  return (await res.json()) as PublicBrandsPage
}

/** Two letters for a brand without a logo. */
export const brandMonogram = (name: string) => name.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2).toUpperCase() || "Y"
