import "server-only"
import { getBrandActor } from "../auth/dal"
import { mediaSrc } from "../media/dto"
import type { OpensSoonBrand } from "./public"

/**
 * True when this request's Brand Studio session acts for `brandId` (its active brand), so it may
 * preview that brand's pages before the shop opens. Reads the session cookie only (a Server
 * Component never rotates it).
 */
export async function viewerActsForBrand(brandId: string) {
  const actor = await getBrandActor()
  return !!actor && actor.brandId === brandId
}

/** The brand as the opens-soon page shows it: its members also see the still-private logo. */
export function opensSoonBrandView(brand: OpensSoonBrand, member: boolean) {
  return { id: brand.id, name: brand.name, logoSrc: member && brand.logoMediaId ? mediaSrc(brand.logoMediaId, "brand") : brand.logoSrc }
}
