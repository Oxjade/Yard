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
  return Object.keys(COMING_SOON.market).map((feature) => ({ feature }))
}

export async function generateMetadata({ params }: PageProps<"/coming-soon/[feature]">): Promise<Metadata> {
  const { feature } = await params
  return { title: comingSoonEntry("market", feature)?.title ?? "Coming soon", robots: { index: false } }
}

export default async function ComingSoonPage({ params }: PageProps<"/coming-soon/[feature]">) {
  const { feature } = await params
  const entry = comingSoonEntry("market", feature)
  if (!entry) notFound()
  return <ComingSoon surface="market" entry={entry} />
}
