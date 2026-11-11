import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { COMING_SOON, ComingSoon, comingSoonEntry } from "@/components/sample/coming-soon"

/**
 * What a sample-data screen shows in production: src/proxy.ts redirects its address here when the
 * demo switch is off. Every feature is prerendered.
 */
export const instant = false
export const ensureStatic = "navigation"

export function generateStaticParams() {
  return Object.keys(COMING_SOON.admin).map((feature) => ({ feature }))
}

export async function generateMetadata({ params }: PageProps<"/admin/coming-soon/[feature]">): Promise<Metadata> {
  const { feature } = await params
  return { title: comingSoonEntry("admin", feature)?.title ?? "Coming soon", robots: { index: false } }
}

export default async function ComingSoonPage({ params }: PageProps<"/admin/coming-soon/[feature]">) {
  const { feature } = await params
  const entry = comingSoonEntry("admin", feature)
  if (!entry) notFound()
  return <ComingSoon surface="admin" entry={entry} />
}
