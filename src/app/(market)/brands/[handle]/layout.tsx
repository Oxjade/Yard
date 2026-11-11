import { notFound } from "next/navigation"
import { brandPageExists } from "@/server/catalog/page-exists"

/**
 * Checks the handle before anything streams, so an unknown storefront still answers with a
 * real 404 while the page below it can have a loading state (loading.tsx sits inside this
 * layout). The not-found page is one level up, where a layout's notFound() is caught. In
 * production src/proxy.ts makes the same check first (the prerendered shell has already said 200
 * by the time this layout runs); this one covers client navigations and development.
 */
export const instant = false

export default async function BrandLayout({ children, params }: LayoutProps<"/brands/[handle]">) {
  const { handle } = await params
  if (!(await brandPageExists(handle))) notFound()
  return children
}
