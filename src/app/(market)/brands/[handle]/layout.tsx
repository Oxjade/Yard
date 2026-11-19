import { notFound } from "next/navigation"
import { OpensSoonPage } from "@/components/market/opens-soon"
import { opensSoonBrandView, viewerActsForBrand } from "@/server/catalog/opens-soon"
import { brandPageState } from "@/server/catalog/page-exists"
import { opensSoonBrand } from "@/server/catalog/public"

/**
 * Checks the handle before anything streams, so an unknown storefront still answers with a
 * real 404 while the page below it can have a loading state (loading.tsx sits inside this
 * layout). The not-found page is one level up, where a layout's notFound() is caught. In
 * production src/proxy.ts makes the same check first (the prerendered shell has already said 200
 * by the time this layout runs); this one covers client navigations and development.
 *
 * A founding brand that hasn't published its storefront yet (page-visibility.ts "opens-soon")
 * gets the "opens soon" page with Follow instead of not-found, at every address under it; its own
 * members get the same page under a "Publish my shop" banner.
 */
export const instant = false

export default async function BrandLayout({ children, params }: LayoutProps<"/brands/[handle]">) {
  const { handle } = await params
  const state = await brandPageState(handle)
  if (state === "public") return children
  if (state === "none") notFound()
  const brand = await opensSoonBrand(handle)
  if (!brand) notFound()
  const member = await viewerActsForBrand(brand.id)
  return <OpensSoonPage brand={opensSoonBrandView(brand, member)} kind="brand" member={member} />
}
