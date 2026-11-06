import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { DropBuilder } from "@/components/studio/growth/drop-builder"
import { drops } from "@/lib/data"
import { STUDIO_BRAND_ID } from "@/lib/data/brands"

export const metadata: Metadata = { title: "Edit drop" }

/**
 * The id is checked before anything renders so an unknown drop answers with a real 404.
 * That check needs the URL, so this segment may block; the brand's sample drops are prerendered.
 */
export const instant = false

/** Drops created in Studio get ids like d_local_<base36>; they live in the local Studio store. */
const LOCAL_DROP_ID = /^d_local_[a-z0-9]+$/

const brandDrops = drops.filter((d) => d.brandId === STUDIO_BRAND_ID)

export function generateStaticParams() {
  return brandDrops.map((d) => ({ id: d.id }))
}

export default async function EditDropPage({ params }: PageProps<"/studio/drops/[id]">) {
  const { id } = await params
  if (!brandDrops.some((d) => d.id === id) && !LOCAL_DROP_ID.test(id)) notFound()
  return <DropBuilder id={id} />
}
