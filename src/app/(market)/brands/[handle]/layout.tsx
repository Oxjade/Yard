import { notFound } from "next/navigation"
import { getBrand } from "@/lib/data"

/**
 * Checks the handle before anything streams, so an unknown storefront still answers with a
 * real 404 while the page below it can have a loading state (loading.tsx sits inside this
 * layout). The not-found page is one level up, where a layout's notFound() is caught.
 */
export const instant = false

export default async function BrandLayout({ children, params }: LayoutProps<"/brands/[handle]">) {
  const { handle } = await params
  if (!getBrand(handle)) notFound()
  return children
}
