import type { Metadata } from "next"
import { connection } from "next/server"
import { SampleDropPage } from "@/components/market/editorial/sample-drop-page"
import { LiveDropDetail } from "@/components/market/live-drop-detail"
import { brandById, getDrop, productById } from "@/lib/data"
import { getEnv } from "@/server/env"
import { dropBrandName, loadDrop } from "@/server/drops/service"
import { JsonLd } from "@/components/seo/json-ld"
import { breadcrumbJsonLd, collectionPageJsonLd, type ListEntry } from "@/lib/seo/json-ld"
import { publicOrigin } from "@/lib/seo/url"
import { listPublicProducts } from "@/server/catalog/public"

export const instant = false

/** Demo and development keep the sample drops' pages on the demo clock; every other drop is read from the database. */
const sampleDrop = (slug: string) => (getEnv().seedDemo ? getDrop(slug) : undefined)

export async function generateMetadata({ params }: PageProps<"/drops/[slug]">): Promise<Metadata> {
  await connection()
  const { slug } = await params
  const sample = sampleDrop(slug)
  const canonical = { canonical: `/drops/${encodeURIComponent(slug)}` }
  if (sample) return { title: `${sample.name}, ${brandById.get(sample.brandId)?.name ?? "drop"}`, description: sample.description, alternates: canonical }
  const drop = await loadDrop(slug)
  if (!drop) return { title: "Drop not found" }
  const brand = await dropBrandName(drop.brandId)
  return { title: `${drop.name}, ${brand ?? "drop"}`, description: drop.description, alternates: canonical }
}

/** The drop as a CollectionPage of its public pieces, under Drops in the breadcrumb. */
async function DropJsonLd({ slug }: { slug: string }) {
  const sample = sampleDrop(slug)
  let name: string
  let description: string
  let entries: ListEntry[]
  if (sample) {
    name = sample.name
    description = sample.description
    entries = sample.productIds.flatMap((id) => {
      const p = productById.get(id)
      return p && p.status === "published" ? [{ name: p.name, path: `/products/${encodeURIComponent(p.slug)}`, image: p.images[0]?.src }] : []
    })
  } else {
    const drop = await loadDrop(slug)
    if (!drop || drop.status === "cancelled") return null
    name = drop.name
    description = drop.description
    const page = await listPublicProducts({ drop: drop.id, sort: "new", limit: 60, offset: 0 }).catch(() => null)
    entries = (page?.products ?? []).map((p) => ({ name: p.title, path: `/products/${encodeURIComponent(p.slug)}`, image: p.images[0]?.src }))
  }
  const base = publicOrigin()
  const path = `/drops/${encodeURIComponent(slug)}`
  return (
    <JsonLd
      nodes={[
        collectionPageJsonLd(base, { name, description, path, entries }),
        breadcrumbJsonLd(base, [
          { name: "Drops", path: "/drops" },
          { name, path },
        ]),
      ]}
    />
  )
}

export default async function DropPage({ params }: PageProps<"/drops/[slug]">) {
  await connection()
  const { slug } = await params
  const sample = sampleDrop(slug)
  if (sample)
    return (
      <>
        <DropJsonLd slug={slug} />
        <SampleDropPage drop={sample} />
      </>
    )
  return (
    <>
      <DropJsonLd slug={slug} />
      <LiveDropDetail slug={slug} />
    </>
  )
}
