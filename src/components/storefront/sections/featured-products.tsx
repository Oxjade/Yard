"use client"

import { ProductCard } from "@/components/market/product-card"
import { cn } from "@/lib/utils"
import type { Product, StorefrontSection } from "@/lib/data/types"
import { AccentLink, Container, SectionHeading, SectionShell, type StorefrontContext } from "../parts"

type Props = { ctx: StorefrontContext; section: StorefrontSection; index: number; first: boolean; products: Product[]; allHref?: string }

/** A short edit of pieces. Each template sets it differently; the cards stay the marketplace's own. */
export function FeaturedProductsSection({ ctx, section, index, first, products, allHref }: Props) {
  const action = allHref ? <AccentLink href={allHref}>Shop all</AccentLink> : undefined
  const heading = <SectionHeading ctx={ctx} section={section} index={index} action={action} />

  if (ctx.template === "editorial" && products.length >= 5) {
    // A lead piece over two rows needs four beside it to close the grid.
    const [lead, ...rest] = products
    return (
      <SectionShell ctx={ctx} section={section} first={first}>
        <Container>
          {heading}
          <div className="grid grid-cols-2 gap-x-3 gap-y-8 @2xl:gap-x-4 @3xl:grid-cols-4">
            <div className="col-span-2 @3xl:row-span-2">
              <ProductCard product={lead} variant="feature" />
            </div>
            {rest.slice(0, 4).map((p) => (
              <ProductCard key={p.id} product={p} sizes="(min-width: 768px) 22vw, 50vw" />
            ))}
          </div>
        </Container>
      </SectionShell>
    )
  }

  if (ctx.template === "street") {
    return (
      <SectionShell ctx={ctx} section={section} first={first}>
        <Container>
          {heading}
          <div className="grid grid-cols-2 gap-x-3 gap-y-8 @2xl:gap-x-4 @3xl:grid-cols-4">
            {products.slice(0, 8).map((p) => (
              <ProductCard key={p.id} product={p} variant="tall" sizes="(min-width: 768px) 24vw, 50vw" />
            ))}
          </div>
        </Container>
      </SectionShell>
    )
  }

  if (ctx.template === "studio") {
    return (
      <SectionShell ctx={ctx} section={section} first={first}>
        <Container>
          {heading}
          <ol className="grid grid-cols-2 gap-x-3 gap-y-8 @2xl:gap-x-4 @3xl:grid-cols-3">
            {products.map((p, i) => (
              <li key={p.id} className={cn(i === 0 && products.length % 2 === 1 && "col-span-2 @3xl:col-span-1")}>
                <p className="mb-3 flex items-center gap-3 text-xs text-ink-3 tabular" aria-hidden>
                  <span>No. {String(i + 1).padStart(2, "0")}</span>
                  <span className="h-px flex-1 bg-line-soft" />
                </p>
                <ProductCard product={p} sizes="(min-width: 768px) 30vw, 50vw" />
              </li>
            ))}
          </ol>
        </Container>
      </SectionShell>
    )
  }

  // minimal, and an editorial edit too short for a lead piece
  return (
    <SectionShell ctx={ctx} section={section} first={first}>
      <Container>
        {heading}
        <div className={cn("grid grid-cols-2 gap-x-3 gap-y-8 @2xl:gap-x-4", products.length === 3 ? "@3xl:grid-cols-3" : "@3xl:grid-cols-4")}>
          {products.slice(0, 8).map((p) => (
            <ProductCard key={p.id} product={p} variant={ctx.template === "editorial" ? "tall" : "default"} />
          ))}
        </div>
      </Container>
    </SectionShell>
  )
}
