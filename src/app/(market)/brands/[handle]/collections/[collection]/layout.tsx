import { notFound } from "next/navigation"
import { collectionPageExists } from "@/server/catalog/page-exists"

/**
 * Checks the collection against the public catalogue before anything streams, so an unknown,
 * draft or deleted collection still answers with a real 404 while the page has a loading state.
 * Its not-found page sits in collections/, one level up. publicCollection is memoised, so the
 * page's own call is cheap. In production src/proxy.ts makes the same check first.
 */
export const instant = false

export default async function BrandCollectionLayout({ children, params }: LayoutProps<"/brands/[handle]/collections/[collection]">) {
  const { handle, collection } = await params
  if (!(await collectionPageExists(handle, collection))) notFound()
  return children
}
