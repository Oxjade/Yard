import { notFound } from "next/navigation"
import { getDrop } from "@/lib/data"

/**
 * Checks the slug before anything streams, so an unknown drop still answers with a real 404
 * while the page below it can have a loading state (loading.tsx sits inside this layout).
 * The not-found page is one level up, where a layout's notFound() is caught.
 */
export const instant = false

export default async function DropLayout({ children, params }: LayoutProps<"/drops/[slug]">) {
  const { slug } = await params
  if (!getDrop(slug)) notFound()
  return children
}
