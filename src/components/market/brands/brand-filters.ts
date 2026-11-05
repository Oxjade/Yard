import { countries, type CountryCode } from "@/config/markets"
import { aestheticLabels, brands, categories, type BrandSort } from "@/lib/data"
import type { Aesthetic, CategorySlug } from "@/lib/data/types"

/** Directory filters, kept in the URL so a filtered view can be shared and linked to. */
export type BrandFilters = {
  q: string
  category?: CategorySlug
  aesthetic?: Aesthetic
  country?: CountryCode
  sort?: BrandSort
}

export const emptyFilters: BrandFilters = { q: "" }

export const sortOptions: { value: BrandSort; label: string }[] = [
  { value: "trending", label: "Trending" },
  { value: "newest", label: "New" },
  { value: "followers", label: "Most followed" },
  { value: "emerging", label: "Emerging" },
]

/** Only offer filters that match at least one brand. */
export const categoryOptions = categories
  .filter((c) => brands.some((b) => b.categories.includes(c.slug)))
  .map((c) => ({ value: c.slug, label: c.name }))

export const aestheticOptions = (Object.keys(aestheticLabels) as Aesthetic[])
  .filter((a) => brands.some((b) => b.aesthetics.includes(a)))
  .map((a) => ({ value: a, label: aestheticLabels[a] }))

export const countryOptions = (Object.keys(countries) as CountryCode[])
  .filter((c) => brands.some((b) => b.country === c))
  .map((c) => ({ value: c, label: countries[c].name, count: brands.filter((b) => b.country === c).length }))
  .sort((a, b) => a.label.localeCompare(b.label))

export function parseFilters(params: URLSearchParams): BrandFilters {
  const q = params.get("q") ?? ""
  const category = params.get("category") as CategorySlug | null
  const aesthetic = params.get("aesthetic") as Aesthetic | null
  const country = params.get("country")?.toUpperCase() as CountryCode | undefined
  const sort = params.get("sort") as BrandSort | null
  return {
    q,
    category: category && categoryOptions.some((o) => o.value === category) ? category : undefined,
    aesthetic: aesthetic && aestheticOptions.some((o) => o.value === aesthetic) ? aesthetic : undefined,
    country: country && countryOptions.some((o) => o.value === country) ? country : undefined,
    sort: sort && sortOptions.some((o) => o.value === sort) ? sort : undefined,
  }
}

export function toSearch(f: BrandFilters) {
  const p = new URLSearchParams()
  if (f.q.trim()) p.set("q", f.q)
  if (f.category) p.set("category", f.category)
  if (f.aesthetic) p.set("aesthetic", f.aesthetic)
  if (f.country) p.set("country", f.country)
  if (f.sort) p.set("sort", f.sort)
  const s = p.toString()
  return s ? `?${s}` : ""
}

/** Filters narrow the list; sort alone also switches to the full list, in that order. */
export function isFiltering(f: BrandFilters) {
  return !!(f.q.trim() || f.category || f.aesthetic || f.country || f.sort)
}

export function filterCount(f: BrandFilters) {
  return [f.category, f.aesthetic, f.country].filter(Boolean).length
}
