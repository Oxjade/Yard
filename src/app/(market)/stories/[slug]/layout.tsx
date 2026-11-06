import { notFound } from "next/navigation"
import { getStory } from "@/lib/data"

/**
 * Checks the slug before anything streams, so an unknown story still answers with a real 404
 * while the page below it can have a loading state. The not-found page is one level up.
 */
export const instant = false

export default async function StoryLayout({ children, params }: LayoutProps<"/stories/[slug]">) {
  const { slug } = await params
  if (!getStory(slug)) notFound()
  return children
}
