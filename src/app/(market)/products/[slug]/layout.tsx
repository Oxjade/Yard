import { notFound } from "next/navigation"
import { HttpError } from "@/server/http/errors"
import { publicProduct } from "@/server/catalog/public"

/**
 * Checks the slug before anything streams, so an unknown or unpublished product still answers
 * with a real 404 while the page below it can have a loading state (loading.tsx sits inside
 * this layout). The not-found page is one level up, where a layout's notFound() is caught.
 */
export const instant = false

export default async function ProductLayout({ children, params }: LayoutProps<"/products/[slug]">) {
  const { slug } = await params
  try {
    await publicProduct(slug)
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) notFound()
    throw error
  }
  return children
}
