import "server-only"
import { getBrand, getDrop } from "@/lib/data"
import { loadDrop } from "../drops/service"
import { getEnv } from "../env"
import { HttpError } from "../http/errors"
import { publicCollection, publicProduct, publicStorefront } from "./public"

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

/** A drop page: demo and development also answer for the sample drops; cancelled drops have no page. */
export async function dropPageExists(slug: string) {
  if (getEnv().seedDemo && getDrop(slug)) return true
  const drop = await loadDrop(slug)
  return !!drop && drop.status !== "cancelled"
}

export const productPageExists = (slug: string) => found(() => publicProduct(slug))

/**
 * A storefront: a sample brand (in every mode, as before) or a listed brand on the server.
 * Production still lists the sample brands in /brands, search, brand cards and the following
 * feed, so their storefronts must keep answering until those lists are gated on the demo switch;
 * hiding only the storefront would leave every one of those links pointing at a 404.
 */
export async function brandPageExists(handle: string) {
  return !!getBrand(handle) || found(() => publicStorefront(handle))
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
