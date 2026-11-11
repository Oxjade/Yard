import { notFound } from "next/navigation"
import { connection } from "next/server"
import { dropPageExists } from "@/server/catalog/page-exists"

/**
 * Checks the slug before anything streams, so an unknown drop still answers with a real 404
 * while the page below it can have a loading state (loading.tsx sits inside this layout).
 * The not-found page is one level up, where a layout's notFound() is caught. In production the
 * route is served from a prerendered shell that has already said 200, so src/proxy.ts makes the
 * same check (dropPageExists) first; this one covers client navigations and development.
 * Demo and development also answer for the sample drops (shown on the demo clock).
 */
export const instant = false

export default async function DropLayout({ children, params }: LayoutProps<"/drops/[slug]">) {
  await connection()
  const { slug } = await params
  if (!(await dropPageExists(slug))) notFound()
  return children
}
