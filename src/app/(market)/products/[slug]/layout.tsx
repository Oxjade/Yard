import { notFound } from "next/navigation"
import { productPageExists } from "@/server/catalog/page-exists"

/**
 * Checks the slug before anything streams, so an unknown or unpublished product still answers
 * with a real 404 while the page below it can have a loading state (loading.tsx sits inside
 * this layout). The not-found page is one level up, where a layout's notFound() is caught. In
 * production src/proxy.ts makes the same check first (the prerendered shell has already said 200
 * by the time this layout runs); this one covers client navigations and development.
 */
export const instant = false

export default async function ProductLayout({ children, params }: LayoutProps<"/products/[slug]">) {
  const { slug } = await params
  if (!(await productPageExists(slug))) notFound()
  return children
}
