import "server-only"
import { getBrand, getDrop } from "@/lib/data"
import { loadDrop } from "../drops/service"
import { getEnv } from "../env"
import { HttpError } from "../http/errors"
import { publicCollection, publicProduct, publicStorefront } from "./public"
import { isSampleBrand, isSampleDrop, isSampleProduct } from "@/lib/data/sample-ids"
import { sampleOff } from "./sample-guard"

/**
 * Whether a public detail page has anything to show: the one check behind both the segment
 * layouts (notFound() before anything streams) and GET /api/pages/exists, which src/proxy.ts
 * asks before rendering. Production serves these routes from a prerendered (empty) shell whose
 * status is already 200, so a notFound() in the render can no longer change it; the proxy runs
 * before that and is what makes an unknown address answer 404 (see the Next streaming guide,
 * "The HTTP contract"). Keeping the rule in one place means the proxy and the page never disagree.
 */
export type PageKind = "drop" | "product" | "brand" | "collection"

/** True when the call's 404 (an HttpError) means "not there"; any other error propagates. */
async function found(load: () => Promise<unknown>) {
  try {
    await load()
    return true
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return false
    throw error
  }
}

/**
 * A drop page: demo and development also answer for the sample drops; cancelled drops have no
 * page. Production never answers for a sample drop, even when a demo-seeded database holds it.
 */
export async function dropPageExists(slug: string) {
  if (getEnv().seedDemo) {
    if (getDrop(slug)) return true
  } else if (isSampleDrop(slug)) return false
  const drop = await loadDrop(slug)
  return !!drop && drop.status !== "cancelled" && !(sampleOff() && isSampleDrop(drop.id))
}

/** A product page: a public product on the server (publicProduct already hides sample brands in production). */
export const productPageExists = (slug: string) => (sampleOff() && isSampleProduct(slug) ? Promise.resolve(false) : found(() => publicProduct(slug)))

/**
 * A storefront: in demo and development a sample brand or a listed brand on the server; in
 * production only a listed brand on the server. The public storefront read excludes sample brand
 * ids in production (sellable.ts brandLaunchedSql), so a sample handle is a 404 there even when a
 * demo-seeded database holds its row, while a real brand that happens to use the same word is not.
 */
export async function brandPageExists(handle: string) {
  if (getEnv().seedDemo && getBrand(handle)) return true
  if (sampleOff() && isSampleBrand(handle)) return false
  return found(() => publicStorefront(handle))
}

export const collectionPageExists = (handle: string, collection: string) => found(() => publicCollection(handle, collection))

export function pageExists(kind: PageKind, key: string, sub?: string) {
  switch (kind) {
    case "drop":
      return dropPageExists(key)
    case "product":
      return productPageExists(key)
    case "brand":
      return brandPageExists(key)
    case "collection":
      return sub ? collectionPageExists(key, sub) : Promise.resolve(false)
  }
}
