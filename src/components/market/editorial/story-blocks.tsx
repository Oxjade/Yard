import Image from "next/image"
import { ShopProductCard } from "@/components/market/editorial/use-drop-add-block"
import { SectionHeader } from "@/components/market/section-header"
import { productById } from "@/lib/data/products"
import { cn } from "@/lib/utils"
import type { Product, StoryBlock } from "@/lib/data/types"

/** The reading measure for running text: about 70 characters a line. */
const measure = "mx-auto w-full max-w-2xl"

/**
 * The opening drop cap, on the display scale. Kept out of cn(): it reads text-display-* as a
 * colour and would drop it next to text-violet. The paragraph's leading-relaxed reaches
 * ::first-letter through --tw-leading, so the cap names the display line-height itself.
 */
const dropCap =
  "first-letter:float-left first-letter:mt-1 first-letter:mr-2.5 first-letter:font-display first-letter:text-display-xl first-letter:leading-(--text-display-lg--line-height) first-letter:text-violet lg:first-letter:text-display-lg"

function Caption({ children, className }: { children?: string; className?: string }) {
  if (!children) return null
  return <figcaption className={cn("mt-3 text-sm leading-relaxed text-ink-2", className)}>{children}</figcaption>
}

/**
 * Renders a story's blocks as an article. Running text sits on a narrow measure; quotes and
 * pairs widen; full images take the page width (edge to edge on phones); product embeds
 * resolve price and stock live through ProductCard.
 */
export function StoryBlocks({ blocks }: { blocks: StoryBlock[] }) {
  const firstText = blocks.findIndex((b) => b.type === "text")
  return (
    <div className="flex flex-col gap-10 md:gap-14">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "text":
            return (
              <p key={i} className={`${measure} text-pretty text-base leading-relaxed md:text-lg ${i === firstText ? `text-ink ${dropCap}` : "text-ink/90"}`}>
                {block.body}
              </p>
            )
          case "quote":
            return (
              <figure key={i} className="mx-auto w-full max-w-4xl py-2 md:py-6">
                <span aria-hidden className="block h-px w-14 bg-violet" />
                <blockquote className="mt-6 font-display text-display-md text-balance text-ink">
                  <p>&ldquo;{block.body}&rdquo;</p>
                </blockquote>
                {block.cite ? <figcaption className="mt-5 text-sm text-ink-2">{block.cite}</figcaption> : null}
              </figure>
            )
          case "image":
            return block.layout === "full" ? (
              <figure key={i} className="-mx-4 md:mx-0">
                <div className="relative aspect-[4/5] overflow-hidden bg-card sm:aspect-[3/2] md:rounded-lg lg:aspect-[16/9]">
                  <Image src={block.image.src} alt={block.image.alt} fill sizes="(min-width: 1440px) 1376px, 100vw" className="object-cover" />
                </div>
                <Caption className="px-4 md:px-0">{block.caption}</Caption>
              </figure>
            ) : (
              <figure key={i} className="mx-auto w-full max-w-3xl">
                <div className="relative aspect-[4/5] overflow-hidden rounded-lg bg-card sm:aspect-[4/3]">
                  <Image src={block.image.src} alt={block.image.alt} fill sizes="(min-width: 768px) 768px, 100vw" className="object-cover" />
                </div>
                <Caption>{block.caption}</Caption>
              </figure>
            )
          case "pair":
            return (
              <figure key={i} className="mx-auto w-full max-w-5xl">
                <div className="grid grid-cols-2 gap-2 md:gap-4">
                  {block.images.map((im, j) => (
                    <div key={j} className={cn("relative aspect-[4/5] overflow-hidden rounded-lg bg-card", j === 1 && "md:mt-16")}>
                      <Image src={im.src} alt={im.alt} fill sizes="(min-width: 1024px) 500px, 50vw" className="object-cover" />
                    </div>
                  ))}
                </div>
                <Caption>{block.caption}</Caption>
              </figure>
            )
          case "products": {
            const items = block.productIds.map((id) => productById.get(id)).filter((p): p is Product => !!p)
            if (!items.length) return null
            return (
              <section key={i} aria-labelledby={`story-products-${i}`} className={cn("mx-auto w-full border-t border-line-soft pt-10 md:pt-14", items.length >= 3 ? "max-w-5xl" : "max-w-3xl")}>
                <div id={`story-products-${i}`}>
                  <SectionHeader title="Shop the story" description={items.length === 1 ? "The piece in this story." : `The ${items.length} pieces in this story.`} />
                </div>
                <div className={cn("grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-4", items.length >= 3 ? "md:grid-cols-3" : "md:grid-cols-2")}>
                  {items.map((p) => (
                    <ShopProductCard key={p.id} product={p} sizes="(min-width: 1024px) 320px, 50vw" />
                  ))}
                </div>
              </section>
            )
          }
        }
      })}
    </div>
  )
}
