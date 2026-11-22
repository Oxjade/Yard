import type { Metadata } from "next"
import { Suspense } from "react"
import { connection } from "next/server"
import { JsonLd } from "@/components/seo/json-ld"
import { breadcrumbJsonLd, collectionPageJsonLd, type ListEntry } from "@/lib/seo/json-ld"
import { publicOrigin } from "@/lib/seo/url"
import { listPublicDrops } from "@/server/drops/service"
import { log } from "@/server/log"
import { SectionHeader } from "@/components/market/section-header"
import { LiveDropsBoard } from "@/components/market/live-drops-board"
import { DropsBoard } from "@/components/market/editorial/drops-board"
import { accessName, accessRule } from "@/components/market/editorial/drop-facts"
import { drops } from "@/lib/data"
import type { Drop } from "@/lib/data/types"
import { getEnv } from "@/server/env"

export const metadata: Metadata = {
  title: "Drops",
  description: "Limited releases from independent brands: what's live now, the upcoming calendar and past drops.",
  alternates: { canonical: "/drops" },
}

/**
 * Structured data: Drops as a CollectionPage of the public drops (live and upcoming first, then
 * recent past ones). Read at request time behind Suspense, so the page's shell stays static.
 */
async function DropsJsonLd() {
  await connection()
  const demo = getEnv().seedDemo
  let entries: ListEntry[] = demo ? drops.map((d) => ({ name: d.name, path: `/drops/${encodeURIComponent(d.slug)}`, image: d.image.src })) : []
  try {
    const [live, upcoming, ended] = await Promise.all([listPublicDrops({ phase: "live", limit: 20 }), listPublicDrops({ phase: "upcoming", limit: 20 }), listPublicDrops({ phase: "ended", limit: 20 })])
    const seen = new Set(entries.map((e) => e.path))
    for (const d of [...live.items, ...upcoming.items, ...ended.items]) {
      const path = `/drops/${encodeURIComponent(d.slug)}`
      if (!seen.has(path)) entries.push({ name: d.name, path })
      seen.add(path)
    }
  } catch (e) {
    log.error("[yard] /drops structured data: drop read failed", e)
  }
  entries = entries.slice(0, 60)
  const base = publicOrigin()
  return (
    <JsonLd
      nodes={[
        collectionPageJsonLd(base, { name: "Drops", description: "Limited releases from independent brands: what's live now, the upcoming calendar and past drops.", path: "/drops", entries }),
        breadcrumbJsonLd(base, [
          { name: "Home", path: "/" },
          { name: "Drops", path: "/drops" },
        ]),
      ]}
    />
  )
}

export default function DropsPage() {
  // Demo and development: the sample drops on the demo clock, as before, then any drop a brand
  // created (from the database). Production: only the database drops.
  const demo = getEnv().seedDemo
  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <Suspense fallback={null}>
        <DropsJsonLd />
      </Suspense>
      <header className="max-w-2xl">
        <h1 className="font-display text-display-lg text-ink">Drops</h1>
        <p className="mt-4 max-w-xl text-pretty text-[0.9375rem] leading-relaxed text-ink-2">
          Limited releases from independent brands, on a schedule. Small runs, clear rules, and a reminder when each one opens.
        </p>
      </header>

      {demo ? (
        <>
          {/* The feature slot and every group below follow the demo clock, so they are picked together on the client. */}
          <DropsBoard drops={drops} />
          <div className="mt-24 md:mt-32">
            <LiveDropsBoard source="brands" hideWhenEmpty title="From brands on Yard" />
          </div>
        </>
      ) : (
        <LiveDropsBoard />
      )}

      <section aria-labelledby="how-title" className="mt-24 md:mt-32">
        <div id="how-title">
          <SectionHeader title="How drops work" description="Three release types. The rules are on every drop before it opens, and they don't change once it's scheduled." />
        </div>
        <dl className="grid gap-px overflow-hidden rounded-lg border border-line-soft bg-line-soft md:grid-cols-3">
          {(Object.keys(accessName) as Drop["access"][]).map((a) => (
            <div key={a} className="bg-obsidian p-5 md:p-6">
              <dt className="font-display text-display-sm text-ink">{accessName[a]}</dt>
              <dd className="mt-3 text-sm leading-relaxed text-ink-2">{accessRule[a]}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  )
}
