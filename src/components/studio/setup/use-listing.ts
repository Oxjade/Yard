"use client"

import { api } from "@/lib/api/client"
import { useApi } from "@/lib/api/use-api"
import { useServerSession } from "@/lib/session/use-server-session"
import type { ListingFacts } from "@/lib/listing-guide"
import { setupStatusDto, type SetupStatusDto } from "./contract"

/** The cache key the Overview card uses too, so the editor, the list and the card share one request. */
export const setupKey = (brandId: string) => `/api/studio/setup#${brandId}`

/**
 * The listing facts (GET /api/studio/setup `listing`) for a live brand session; null for the
 * sample store, signed out, or while loading. Used for "Live on Yard" vs "waiting on your
 * storefront" and for knowing a brand's first publish.
 */
export function useListingFacts(): ListingFacts | null {
  const brand = useServerSession((s) => (s.brand && !s.brand.demo ? s.brand.brand.id : null))
  const { data } = useApi<SetupStatusDto>(brand ? setupKey(brand) : null, () => api<SetupStatusDto>("/api/studio/setup", { schema: setupStatusDto }))
  return data?.listing ?? null
}
