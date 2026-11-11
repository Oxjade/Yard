import { notFound } from "next/navigation"
import { publicCollection } from "@/server/catalog/public"
import { HttpError } from "@/server/http/errors"

/**
 * Checks the collection against the public catalogue before anything streams, so an unknown,
 * draft or deleted collection still answers with a real 404 while the page has a loading state.
 * Its not-found page sits in collections/, one level up. publicCollection is memoised, so the
 * page's own call is cheap.
 */
export const instant = false

export default async function BrandCollectionLayout({ children, params }: LayoutProps<"/brands/[handle]/collections/[collection]">) {
  const { handle, collection } = await params
  try {
    await publicCollection(handle, collection)
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) notFound()
    throw error
  }
  return children
}
