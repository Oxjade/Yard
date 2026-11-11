"use client"

import { useId, useMemo, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { Chip, ChipRadioGroup } from "@/components/market/catalog/chip"
import { ProductCard } from "@/components/market/product-card"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api/client"
import { toCatalogProduct, type PublicCatalogProduct } from "@/lib/api/catalog-products"
import { errorMessage } from "@/lib/api/errors"
import { duration, ease } from "@/lib/motion"
import { cn } from "@/lib/utils"
import type { Product, StorefrontSection } from "@/lib/data/types"
import { Container, SectionHeading, SectionShell, type StorefrontContext } from "../parts"

/** A live server storefront's products arrive one API page at a time (see StorefrontRendererProps). */
export type ProductPaging = { brandId: string; total: number; listed: number; nextOffset: number | null }

type Props = { ctx: StorefrontContext; section: StorefrontSection; index: number; first: boolean; products: Product[]; paging?: ProductPaging }

const PAGE = 60

/** The standard product grid; templates differ in columns and card variant, not in gaps. */
const grid: Record<StorefrontContext["template"], string> = {
  editorial: "grid grid-cols-2 gap-x-3 gap-y-8 @2xl:gap-x-4 @3xl:grid-cols-3 @5xl:grid-cols-4",
  minimal: "grid grid-cols-2 gap-x-3 gap-y-8 @2xl:gap-x-4 @3xl:grid-cols-3 @5xl:grid-cols-4",
  street: "grid grid-cols-2 gap-x-3 gap-y-8 @2xl:gap-x-4 @3xl:grid-cols-4",
  studio: "grid grid-cols-2 gap-x-3 gap-y-8 @2xl:gap-x-4 @3xl:grid-cols-3",
}

/** Every published piece, in the brand's own order, with a small category filter. */
export function AllProductsSection({ ctx, section, index, first, products: given, paging }: Props) {
  const layoutId = useId()
  const [active, setActive] = useState<string>("all")
  const [more, setMore] = useState<{ products: Product[]; nextOffset: number | null }>({ products: [], nextOffset: paging?.nextOffset ?? null })
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Paged: the first page in its order, then each page loaded since (skipping any already shown).
  const products = useMemo(() => {
    if (!paging) return given
    const seen = new Set<string>()
    return [...given.slice(0, paging.listed), ...more.products].filter((p) => !seen.has(p.id) && !!seen.add(p.id))
  }, [given, paging, more.products])

  async function loadMore() {
    if (!paging || more.nextOffset == null || loading) return
    setLoading(true)
    setLoadError(null)
    try {
      const page = await api<{ products: PublicCatalogProduct[]; nextOffset: number | null }>("/api/catalog/products", {
        query: { brand: paging.brandId, limit: PAGE, offset: more.nextOffset, sort: "new" },
      })
      setMore((current) => ({ products: [...current.products, ...page.products.map(toCatalogProduct)], nextOffset: page.nextOffset }))
    } catch (error) {
      setLoadError(errorMessage(error, "More pieces couldn't be loaded. Check your connection and try again."))
    } finally {
      setLoading(false)
    }
  }

  const groups = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of products) counts.set(p.subcategory, (counts.get(p.subcategory) ?? 0) + 1)
    return [...counts.entries()].map(([name, count]) => ({ name, count }))
  }, [products])

  const current = groups.some((g) => g.name === active) ? active : "all"
  const shown = current === "all" ? products : products.filter((p) => p.subcategory === current)
  const options = [{ name: "all", label: "All", count: products.length }, ...groups.map((g) => ({ ...g, label: g.name }))]

  return (
    <SectionShell ctx={ctx} section={section} first={first}>
      <Container>
        <SectionHeading ctx={ctx} section={section} index={index} />

        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          {groups.length > 1 ? (
            <ChipRadioGroup label={`Filter ${ctx.brand.name} products by category`} className="rail -mx-4 flex gap-2 overflow-x-auto px-4 @3xl:mx-0 @3xl:flex-wrap @3xl:overflow-visible @3xl:px-0">
              {options.map((o) => {
                const on = current === o.name
                return (
                  <Chip
                    key={o.name}
                    selected={on}
                    onClick={() => setActive(o.name)}
                    layoutId={`${layoutId}-pill`}
                    radio
                    // The marketplace chip, filled in the brand accent instead of purple (purple when the accent is reserved, see theme).
                    className={cn(on && "border-(color:--sf-selected) text-(color:--sf-on-selected) [&>span:first-child]:bg-(color:--sf-selected)")}
                  >
                    {o.label}
                    <span className={cn("text-xs tabular", on ? "opacity-70" : "text-ink-3")}>{o.count}</span>
                  </Chip>
                )
              })}
            </ChipRadioGroup>
          ) : null}
          <p className="text-sm text-ink-2 tabular" aria-live="polite">
            {paging && current === "all" && paging.total > shown.length
              ? `${shown.length} of ${paging.total} pieces`
              : `${shown.length} ${shown.length === 1 ? "piece" : "pieces"}`}
          </p>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={current}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: duration.page, ease: ease.out }}
            className={grid[ctx.template]}
          >
            {shown.map((p) => (
              <ProductCard key={p.id} product={p} variant={ctx.template === "street" ? "tall" : "default"} />
            ))}
          </motion.div>
        </AnimatePresence>

        {paging && more.nextOffset != null ? (
          <div className="mt-10 grid justify-items-center gap-3">
            {loadError ? <p role="alert" className="text-sm text-danger">{loadError}</p> : null}
            <Button type="button" variant="secondary" loading={loading} onClick={() => void loadMore()} disabled={ctx.preview}>
              Load more pieces
            </Button>
          </div>
        ) : null}
      </Container>
    </SectionShell>
  )
}
