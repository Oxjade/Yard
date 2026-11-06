import { notFound } from "next/navigation"
import { categoryBySlug } from "@/lib/data"
import type { CategorySlug } from "@/lib/data/types"

/**
 * Checks the slug before anything streams, so an unknown category still answers with a real
 * 404 while the page below it can have a loading state (loading.tsx sits inside this layout).
 * The not-found page is one level up, where a layout's notFound() is caught.
 */
export const instant = false

export default async function CategoryLayout({ children, params }: LayoutProps<"/categories/[slug]">) {
  const { slug } = await params
  if (!categoryBySlug.has(slug as CategorySlug)) notFound()
  return children
}
