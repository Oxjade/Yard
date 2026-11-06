import { notFound } from "next/navigation"
import { collectionsOf, getBrand } from "@/lib/data"

/**
 * Checks the collection before anything streams, so an unknown one still answers with a real
 * 404 while the page has a loading state. Its not-found page sits in collections/, one level up.
 */
export const instant = false

export default async function BrandCollectionLayout({ children, params }: LayoutProps<"/brands/[handle]/collections/[collection]">) {
  const { handle, collection } = await params
  const brand = getBrand(handle)
  if (!brand || !collectionsOf(brand.id).some((c) => c.handle === collection)) notFound()
  return children
}
