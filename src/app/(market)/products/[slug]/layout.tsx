import { notFound } from "next/navigation"
import { OpensSoonPage } from "@/components/market/opens-soon"
import { opensSoonBrandView, viewerActsForBrand } from "@/server/catalog/opens-soon"
import { productPageState } from "@/server/catalog/page-exists"
import { opensSoonProduct } from "@/server/catalog/public"

/**
 * Checks the slug before anything streams, so an unknown or unpublished product still answers
 * with a real 404 while the page below it can have a loading state (loading.tsx sits inside
 * this layout). The not-found page is one level up, where a layout's notFound() is caught. In
 * production src/proxy.ts makes the same check first (the prerendered shell has already said 200
 * by the time this layout runs); this one covers client navigations and development.
 *
 * A published piece of a founding brand that hasn't opened its shop yet (page-visibility.ts
 * "opens-soon") gets the "opens soon" page instead of not-found; the brand's own members get the
 * page itself, with a preview banner (page.tsx).
 */
export const instant = false

export default async function ProductLayout({ children, params }: LayoutProps<"/products/[slug]">) {
  const { slug } = await params
  const state = await productPageState(slug)
  if (state === "public") return children
  if (state === "none") notFound()
  const soon = await opensSoonProduct(slug)
  if (!soon) notFound()
  if (await viewerActsForBrand(soon.brand.id)) return children
  return <OpensSoonPage brand={opensSoonBrandView(soon.brand, false)} kind="product" member={false} />
}
