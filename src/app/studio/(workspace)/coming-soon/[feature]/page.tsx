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
  return Object.keys(COMING_SOON.studio).map((feature) => ({ feature }))
}

export async function generateMetadata({ params }: PageProps<"/studio/coming-soon/[feature]">): Promise<Metadata> {
  const { feature } = await params
  return { title: comingSoonEntry("studio", feature)?.title ?? "Coming soon", robots: { index: false } }
}

export default async function ComingSoonPage({ params }: PageProps<"/studio/coming-soon/[feature]">) {
  const { feature } = await params
  const entry = comingSoonEntry("studio", feature)
  if (!entry) notFound()
  return <ComingSoon surface="studio" entry={entry} />
}
