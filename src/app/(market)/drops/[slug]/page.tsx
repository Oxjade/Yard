import type { Metadata } from "next"
import { connection } from "next/server"
import { SampleDropPage } from "@/components/market/editorial/sample-drop-page"
import { LiveDropDetail } from "@/components/market/live-drop-detail"
import { brandById, getDrop } from "@/lib/data"
import { getEnv } from "@/server/env"
import { dropBrandName, loadDrop } from "@/server/drops/service"

export const instant = false

/** Demo and development keep the sample drops' pages on the demo clock; every other drop is read from the database. */
const sampleDrop = (slug: string) => (getEnv().seedDemo ? getDrop(slug) : undefined)

export async function generateMetadata({ params }: PageProps<"/drops/[slug]">): Promise<Metadata> {
  await connection()
  const { slug } = await params
  const sample = sampleDrop(slug)
  if (sample) return { title: `${sample.name}, ${brandById.get(sample.brandId)?.name ?? "drop"}`, description: sample.description }
  const drop = await loadDrop(slug)
  if (!drop) return { title: "Drop not found" }
  const brand = await dropBrandName(drop.brandId)
  return { title: `${drop.name}, ${brand ?? "drop"}`, description: drop.description }
}

export default async function DropPage({ params }: PageProps<"/drops/[slug]">) {
  await connection()
  const { slug } = await params
  const sample = sampleDrop(slug)
  if (sample) return <SampleDropPage drop={sample} />
  return <LiveDropDetail slug={slug} />
}
