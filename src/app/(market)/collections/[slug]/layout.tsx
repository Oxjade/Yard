import { notFound } from "next/navigation"
import { getCuratedCollection } from "@/lib/data"

/**
 * Checks the slug before anything streams, so an unknown edit still answers with a real 404
 * while the page below it can have a loading state. The not-found page is one level up.
 */
export const instant = false

export default async function CuratedCollectionLayout({ children, params }: LayoutProps<"/collections/[slug]">) {
  const { slug } = await params
  if (!getCuratedCollection(slug)) notFound()
  return children
}
