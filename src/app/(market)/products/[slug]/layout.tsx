import { notFound } from "next/navigation"
import { getProduct } from "@/lib/data"

/**
 * Checks the slug before anything streams, so an unknown or unpublished product still answers
 * with a real 404 while the page below it can have a loading state (loading.tsx sits inside
 * this layout). The not-found page is one level up, where a layout's notFound() is caught.
 */
export const instant = false

export default async function ProductLayout({ children, params }: LayoutProps<"/products/[slug]">) {
  const { slug } = await params
  const product = getProduct(slug)
  if (!product || product.status !== "published") notFound()
  return children
}
