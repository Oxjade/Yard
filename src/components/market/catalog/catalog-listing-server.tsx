import { connection } from "next/server"
import { toCatalogProduct } from "@/lib/api/catalog-products"
import type { CategorySlug } from "@/lib/data/types"
import { listPublicProducts } from "@/server/catalog/public"
import { CatalogListing } from "./catalog-listing"

/** The page size the browser also loads the catalogue in (loadPublicCatalog). */
const FIRST_PAGE = 60

/**
 * The listing with its first page read on the server, so the HTML carries products (crawlers,
 * no-JS, first paint). The browser loads the rest only when there is more. If the read fails, the
 * listing loads everything itself, as before.
 */
export async function CatalogListingServer({ category }: { category?: CategorySlug }) {
  // Outside the catch: during prerender this suspends the request-time part, which must not be swallowed.
  await connection()
  const first = await listPublicProducts({ ...(category ? { category } : {}), sort: "new", limit: FIRST_PAGE, offset: 0 }).catch(() => null)
  return <CatalogListing category={category} initialProducts={first?.products.map(toCatalogProduct)} initialComplete={!!first && first.nextOffset == null} />
}
