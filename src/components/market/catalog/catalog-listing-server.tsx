import { connection } from "next/server"
import type { CategorySlug } from "@/lib/data/types"
import { CatalogListing } from "./catalog-listing"

export async function CatalogListingServer({ category }: { category?: CategorySlug }) {
  await connection()
  return <CatalogListing category={category} />
}
