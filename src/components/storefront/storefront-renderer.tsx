"use client"

import { Fragment } from "react"
import { ShopProductCard } from "@/components/market/editorial/use-drop-add-block"
import { cn } from "@/lib/utils"
import type { Brand, Collection, Drop, Product, Story, StorefrontConfig, StorefrontSection } from "@/lib/data/types"
import { AnnouncementBar, CollectionIndex, Container, PreviewPlaceholder, StorefrontFooter, headerClearance, type StorefrontContext } from "./parts"
import { AllProductsSection } from "./sections/all-products"
import { CollectionsSection } from "./sections/collections"
import { DropsSection, groupDrops } from "./sections/drops"
import { FeaturedProductsSection } from "./sections/featured-products"
import { HeroSection } from "./sections/hero"
import { LookbookSection } from "./sections/lookbook"
import { StorySection } from "./sections/story"
import { accentStyle, collectionIndexId, collectionsAnchorId, lookbookFrames, resolveCollections, resolveFeatured, saleProducts, storefrontType } from "./theme"

export type StorefrontRendererProps = {
  brand: Brand
  config: StorefrontConfig
  /** The brand's published products, in the brand's own order. */
  products: Product[]
  collections: Collection[]
  drops: Drop[]
  stories: Story[]
  /**
   * Draft preview inside Brand Studio: no header clearance, no navigation away, Follow is
   * inert, and empty sections show a placeholder instead of disappearing.
   */
  preview?: boolean
  className?: string
}

/**
 * Renders a brand storefront from its config. Pure: everything comes from props, so the
 * live page and the Studio editor render exactly the same thing. Layouts use container
 * queries, so a draft renders correctly in an editor pane of any width.
 */
export function StorefrontRenderer({ brand, config, products, collections, drops, stories, preview = false, className }: StorefrontRendererProps) {
  const ctx: StorefrontContext = {
    brand,
    template: config.template,
    type: storefrontType[config.typePreset] ?? storefrontType.condensed,
    preview,
  }
  const sections = config.sections.filter((s) => s.enabled)
  const announcement = config.announcement?.text?.trim() ? config.announcement : null
  const sale = saleProducts(products)
  const hasHero = sections.some((s) => s.type === "hero")
  const allProducts = sections.find((s) => s.type === "all-products")
  const featuredSection = sections.find((s) => s.type === "featured-products")
  const shopTarget = products.length ? (allProducts ?? featuredSection) : undefined
  const shopHref = shopTarget ? `#sf-${shopTarget.id}` : undefined

  // Sections other than the hero are numbered in the order they appear.
  let counter = 0
  let rendered = 0

  function renderSection(section: StorefrontSection, first: boolean) {
    const index = section.type === "hero" ? 0 : ++counter
    const common = { ctx, section, first, index }
    switch (section.type) {
      case "hero":
        return <HeroSection ctx={ctx} section={section} first={first} intro={config.intro || brand.description} products={products} shopHref={shopHref} />
      case "featured-products": {
        const featured = resolveFeatured(section, products, config.template === "editorial" ? 5 : config.template === "studio" ? 3 : 4)
        if (!featured.length) return placeholder(section, first, index, "Add products in Brand Studio, or pick some for this section.")
        return <FeaturedProductsSection {...common} products={featured} allHref={allProducts && products.length > featured.length ? `#sf-${allProducts.id}` : undefined} />
      }
      case "collections": {
        const list = resolveCollections(section, collections)
        if (!list.length) return placeholder(section, first, index, "Create a collection to show it here.")
        return <CollectionsSection {...common} collections={list} />
      }
      case "drops":
        if (!groupDrops(drops).length) return placeholder(section, first, index, "Schedule a drop to show it here.")
        return <DropsSection {...common} drops={drops} products={products} />
      case "story":
        if (!brand.story.length) return placeholder(section, first, index, "Write your story in Brand Studio settings.")
        return <StorySection {...common} stories={stories} />
      case "lookbook": {
        const frames = lookbookFrames(brand, products, config.template === "street" || config.template === "editorial" ? 5 : 4, { coverInHero: hasHero })
        if (frames.length < 3) return placeholder(section, first, index, "A lookbook needs at least three photographs.")
        return <LookbookSection {...common} frames={frames} />
      }
      case "all-products":
        if (!products.length) return placeholder(section, first, index, "Publish a product to show it here.")
        return <AllProductsSection {...common} products={products} />
      default:
        return null
    }
  }

  function placeholder(section: StorefrontSection, first: boolean, index: number, reason: string) {
    if (!preview) {
      counter--
      return null
    }
    return <PreviewPlaceholder ctx={ctx} section={section} first={first} index={index} reason={reason} />
  }

  // Under the hero: the collections index (when the collections section is off) and the
  // Sale strip. With no hero they open the page instead.
  const indexCollections = collectionsAnchorId(config, collections) === collectionIndexId ? collections : []
  const leadIns = (atTop: boolean) => {
    const items: React.ReactNode[] = []
    if (indexCollections.length) items.push(<CollectionIndex key="index" ctx={ctx} collections={indexCollections} first={atTop && items.length === 0} />)
    if (sale.length) items.push(<SaleStrip key="sale" ctx={ctx} products={sale} first={atTop && items.length === 0} />)
    return items
  }
  const topLeadIns = hasHero ? [] : leadIns(!announcement)

  return (
    <div
      data-storefront={config.template}
      style={accentStyle(config.accent)}
      className={cn("@container relative w-full", preview && "pb-12", className)}
      onClickCapture={
        preview
          ? (e) => {
              // A preview never navigates away from the editor.
              if ((e.target as HTMLElement).closest("a")) e.preventDefault()
            }
          : undefined
      }
    >
      {announcement ? <AnnouncementBar ctx={ctx} text={announcement.text} href={announcement.href} /> : null}

      {topLeadIns}

      {sections.map((section) => {
        const first = rendered === 0 && !announcement && topLeadIns.length === 0
        const node = renderSection(section, first)
        if (node) rendered++
        return (
          <Fragment key={section.id}>
            {node}
            {section.type === "hero" ? leadIns(false) : null}
          </Fragment>
        )
      })}

      {sections.length === 0 && preview ? (
        <Container className="pt-8">
          <div className="rounded-lg border border-dashed border-line px-5 py-16 text-center">
            <p className="text-sm text-ink">Every section is hidden</p>
            <p className="mt-1 text-sm text-ink-2">Turn a section on to see your storefront here.</p>
          </div>
        </Container>
      ) : null}

      <StorefrontFooter ctx={ctx} />
    </div>
  )
}

/**
 * Promotions: reduced pieces, shown whenever the brand has any. On phones it reads as a
 * section with the standard two-up grid; from tablet up it is a card with the note beside
 * the pieces. One or two pieces keep a fixed card width so names and both prices fit.
 */
function SaleStrip({ ctx, products, first }: { ctx: StorefrontContext; products: Product[]; first: boolean }) {
  const n = products.length
  const few = n <= 2
  return (
    <section aria-labelledby="sf-sale-title" className={cn(first ? (ctx.preview ? "pt-8" : headerClearance) : "mt-10 @3xl:mt-14")}>
      <Container>
        <div
          className={cn(
            "grid gap-6 border-t border-line-soft pt-6 @3xl:items-center @3xl:gap-10 @3xl:rounded-lg @3xl:border @3xl:bg-card @3xl:p-6",
            few ? "@3xl:grid-cols-[minmax(0,1fr)_auto]" : "@3xl:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]",
          )}
        >
          <div className="max-w-md">
            <h2 id="sf-sale-title" className={cn(ctx.type.family, ctx.type.title, "text-ink")}>Sale</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">
              {n === 1 ? "One piece is" : `${n} pieces are`} reduced at {ctx.brand.name} while stock lasts. Prices show in your currency.
            </p>
          </div>
          <div
            className={cn(
              "grid gap-x-3 gap-y-8 @2xl:gap-x-4",
              n === 1 ? "max-w-72 grid-cols-1 @3xl:w-64" : few ? "grid-cols-2 @3xl:grid-cols-[repeat(2,16rem)]" : "grid-cols-2 @xl:grid-cols-3 @5xl:grid-cols-5",
            )}
          >
            {products.map((p) => (
              <ShopProductCard key={p.id} product={p} variant="compact" sizes={few ? "(min-width: 768px) 16rem, 45vw" : "(min-width: 1024px) 14vw, 45vw"} />
            ))}
          </div>
        </div>
      </Container>
    </section>
  )
}
