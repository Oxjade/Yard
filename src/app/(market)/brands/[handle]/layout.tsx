import { notFound } from "next/navigation"
import { getBrand } from "@/lib/data"
import { HttpError } from "@/server/http/errors"
import { publicStorefront } from "@/server/catalog/public"

/**
 * Checks the handle before anything streams, so an unknown storefront still answers with a
 * real 404 while the page below it can have a loading state (loading.tsx sits inside this
 * layout). The not-found page is one level up, where a layout's notFound() is caught.
 */
export const instant = false

export default async function BrandLayout({ children, params }: LayoutProps<"/brands/[handle]">) {
  const { handle } = await params
  if (!getBrand(handle)) {
    try {
      await publicStorefront(handle)
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) notFound()
      throw error
    }
  }
  return children
}
