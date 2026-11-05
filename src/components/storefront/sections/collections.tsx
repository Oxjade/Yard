"use client"

import Image from "next/image"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Collection, StorefrontSection } from "@/lib/data/types"
import { Container, SectionHeading, SectionShell, type StorefrontContext } from "../parts"

type Props = { ctx: StorefrontContext; section: StorefrontSection; index: number; first: boolean; collections: Collection[] }

const pieces = (c: Collection) => `${c.productIds.length} ${c.productIds.length === 1 ? "piece" : "pieces"}`

export function collectionHref(handle: string, collection: Collection) {
  return `/brands/${handle}/collections/${collection.handle}`
}

export function CollectionsSection({ ctx, section, index, first, collections }: Props) {
  const { brand, template, type } = ctx
  const single = collections.length === 1

  return (
    <SectionShell ctx={ctx} section={section} first={first}>
      <Container>
        <SectionHeading ctx={ctx} section={section} index={index} />

        {template === "editorial" ? (
          // Alternating spreads: image one side, the collection's name and note the other.
          <div className="grid gap-12 @3xl:gap-16">
            {collections.map((c, i) => (
              <article key={c.id} className="group grid gap-6 @3xl:grid-cols-12 @3xl:items-center @3xl:gap-10">
                <Link
                  href={collectionHref(brand.handle, c)}
                  className={cn("relative block aspect-[4/3] overflow-hidden rounded-lg bg-card @3xl:col-span-7", i % 2 === 1 && "@3xl:order-last")}
                  aria-label={c.name}
                >
                  <Image src={c.image.src} alt={c.image.alt} fill sizes="(min-width: 768px) 58vw, 100vw" className="object-cover transition-transform duration-[900ms] ease-out-quint group-hover:scale-[1.03]" />
                </Link>
                <div className="@3xl:col-span-5">
                  <p className="text-xs text-ink-3 tabular">{pieces(c)}</p>
                  <h3 className={cn("mt-3", type.family, type.heading, "text-ink")}>
                    <Link href={collectionHref(brand.handle, c)} className="transition-colors hover:text-(color:--sf-accent)">{c.name}</Link>
                  </h3>
                  <p className="mt-4 max-w-sm text-pretty text-[0.9375rem] leading-relaxed text-ink-2">{c.description}</p>
                  <Button asChild variant="secondary" className="mt-6">
                    <Link href={collectionHref(brand.handle, c)}>Shop the collection</Link>
                  </Button>
                </div>
              </article>
            ))}
          </div>
        ) : template === "street" ? (
          // Poster tiles: the name in heavy type over the image.
          <div className={cn("grid gap-2 @3xl:gap-3", !single && "@2xl:grid-cols-2")}>
            {collections.map((c) => (
              <Link
                key={c.id}
                href={collectionHref(brand.handle, c)}
                className={cn(
                  "group relative isolate flex aspect-[4/3] flex-col justify-end overflow-hidden rounded-lg bg-card p-5 @3xl:p-7",
                  single ? "@3xl:aspect-[21/9]" : "@3xl:aspect-[16/10]",
                )}
              >
                <Image src={c.image.src} alt={c.image.alt} fill sizes="(min-width: 640px) 50vw, 100vw" className="-z-10 object-cover transition-transform duration-[900ms] ease-out-quint group-hover:scale-[1.04]" />
                <span aria-hidden className="scrim-b absolute inset-0 -z-10" />
                <span aria-hidden className="absolute inset-x-0 bottom-0 -z-10 h-1 origin-left scale-x-0 bg-(color:--sf-accent) transition-transform duration-500 ease-out-quint group-hover:scale-x-100" />
                <h3 className={cn(type.family, type.heading, "text-ink")}>{c.name}</h3>
                <p className="mt-2 text-sm text-ink/80">{c.description}</p>
                <p className="mt-3 text-xs text-(color:--sf-accent) tabular">{pieces(c)}</p>
              </Link>
            ))}
          </div>
        ) : template === "studio" ? (
          // Plates: each image held on a card like a print in a mount.
          <div className={cn("grid gap-4", single ? "" : collections.length === 2 ? "@2xl:grid-cols-2" : "@2xl:grid-cols-2 @4xl:grid-cols-3")}>
            {collections.map((c, i) => (
              <Link
                key={c.id}
                href={collectionHref(brand.handle, c)}
                className={cn("group rounded-lg border border-line-soft bg-card p-3 transition-colors hover:border-line @3xl:p-4", single && "@3xl:grid @3xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] @3xl:items-end @3xl:gap-8")}
              >
                <div className={cn("relative overflow-hidden rounded-md bg-surface", single ? "aspect-[4/3] @3xl:aspect-[16/9]" : "aspect-square")}>
                  <Image src={c.image.src} alt={c.image.alt} fill sizes="(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 100vw" className="object-cover transition-transform duration-[900ms] ease-out-quint group-hover:scale-[1.03]" />
                </div>
                <div className={cn(single && "@3xl:pb-2")}>
                  <div className="mt-4 flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className={cn(type.family, single ? type.heading : type.title, "text-ink transition-colors group-hover:text-(color:--sf-accent)")}>{c.name}</h3>
                      <p className="mt-2 line-clamp-2 text-sm text-ink-2">{c.description}</p>
                    </div>
                    <span className="shrink-0 text-xs text-ink-3 tabular">{String(i + 1).padStart(2, "0")}</span>
                  </div>
                  <p className="mt-3 text-xs text-ink-3 tabular">{pieces(c)}</p>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          // Minimal: quiet tiles, text under the image.
          <div className={cn("grid gap-x-4 gap-y-8", single ? "" : collections.length === 2 ? "@2xl:grid-cols-2" : "@2xl:grid-cols-2 @4xl:grid-cols-3")}>
            {collections.map((c) => (
              <Link key={c.id} href={collectionHref(brand.handle, c)} className="group">
                <div className={cn("relative overflow-hidden rounded-lg bg-card", single ? "aspect-[4/3] @3xl:aspect-[21/9]" : "aspect-[4/3]")}>
                  <Image src={c.image.src} alt={c.image.alt} fill sizes="(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 100vw" className="object-cover transition-transform duration-[900ms] ease-out-quint group-hover:scale-[1.03]" />
                </div>
                <div className="mt-4 flex items-baseline justify-between gap-4">
                  <h3 className="text-base text-ink transition-colors group-hover:text-(color:--sf-accent)">{c.name}</h3>
                  <span className="shrink-0 text-xs text-ink-3 tabular">{pieces(c)}</span>
                </div>
                <p className="mt-1 text-sm text-ink-2">{c.description}</p>
              </Link>
            ))}
          </div>
        )}
      </Container>
    </SectionShell>
  )
}
