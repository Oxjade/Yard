"use client"

import Image from "next/image"
import Link from "next/link"
import { cn } from "@/lib/utils"
import type { StorefrontSection } from "@/lib/data/types"
import { Container, SectionHeading, SectionShell, type StorefrontContext } from "../parts"
import type { LookbookFrame } from "../theme"

type Props = { ctx: StorefrontContext; section: StorefrontSection; index: number; first: boolean; frames: LookbookFrame[] }

/** One photograph. Frames that show a product link to it and name it. */
function Frame({
  frame,
  className,
  sizes,
  caption = "overlay",
  stretch = false,
  position,
}: {
  frame: LookbookFrame
  className?: string
  sizes: string
  /** object-position for crops that cut far into a portrait photograph. */
  position?: string
  caption?: "overlay" | "below" | "none"
  /** From the 3xl container size up, fill the grid cell's height instead of keeping a ratio. */
  stretch?: boolean
}) {
  const { image, product } = frame
  const fill = stretch && "@3xl:h-full @3xl:min-h-0"
  const picture = (
    <span className={cn("relative block overflow-hidden rounded-lg bg-card", className, stretch && "@3xl:aspect-auto @3xl:h-full")}>
      <Image src={image.src} alt={image.alt} fill sizes={sizes} className={cn("object-cover transition-transform duration-[900ms] ease-out-quint group-hover:scale-[1.03]", position)} />
      {product && caption === "overlay" ? (
        <>
          <span aria-hidden className="scrim-b absolute inset-0" />
          <span className="absolute inset-x-0 bottom-0 p-3 text-xs text-ink @3xl:p-4 @3xl:text-sm">{product.name}</span>
        </>
      ) : null}
    </span>
  )
  if (!product) return <figure className={cn("group", fill)}>{picture}</figure>
  return (
    <figure className={cn("group", fill)}>
      <Link href={`/products/${product.slug}`} aria-label={`Shop ${product.name}`} className={cn("block", fill)}>
        {picture}
      </Link>
      {caption === "below" ? (
        <figcaption className="mt-2 truncate text-xs text-ink-2">
          <Link href={`/products/${product.slug}`} className="transition-colors hover:text-(color:--sf-accent)">{product.name}</Link>
        </figcaption>
      ) : null}
    </figure>
  )
}

export function LookbookSection({ ctx, section, index, first, frames }: Props) {
  const { template } = ctx
  const heading = <SectionHeading ctx={ctx} section={section} index={index} description="Tap a photograph to shop the piece in it." />

  if (template === "editorial") {
    // A magazine spread: one tall frame, two stacked beside it, then a wide closer.
    const [a, b, c, d, e] = frames
    return (
      <SectionShell ctx={ctx} section={section} first={first}>
        <Container>
          {heading}
          <div className="grid gap-3 @3xl:grid-cols-12 @3xl:gap-4">
            <div className="@3xl:col-span-7">
              <Frame frame={a} className="aspect-[4/5]" sizes="(min-width: 768px) 58vw, 100vw" />
            </div>
            {b ? (
              <div className={cn("grid grid-cols-2 gap-3 @3xl:col-span-5 @3xl:grid-cols-1 @3xl:gap-4", c && "@3xl:grid-rows-2")}>
                <Frame frame={b} className="aspect-[4/5]" sizes="(min-width: 768px) 40vw, 50vw" stretch />
                {c ? <Frame frame={c} className="aspect-[4/5]" sizes="(min-width: 768px) 40vw, 50vw" stretch /> : null}
              </div>
            ) : null}
            {d && e ? (
              <>
                <div className="@3xl:col-span-6">
                  <Frame frame={d} className="aspect-[4/3]" sizes="(min-width: 768px) 50vw, 100vw" position="object-[50%_30%]" />
                </div>
                <div className="@3xl:col-span-6">
                  <Frame frame={e} className="aspect-[4/3]" sizes="(min-width: 768px) 50vw, 100vw" position="object-[50%_30%]" />
                </div>
              </>
            ) : d ? (
              <div className="@3xl:col-span-12">
                <Frame frame={d} className="aspect-[4/3] @3xl:aspect-[16/9]" sizes="100vw" position="object-[50%_35%]" />
              </div>
            ) : null}
          </div>
        </Container>
      </SectionShell>
    )
  }

  if (template === "street") {
    // A tight collage: one big square and four small ones.
    return (
      <SectionShell ctx={ctx} section={section} first={first}>
        <Container>
          {heading}
          <div className="grid grid-cols-2 gap-1.5 @3xl:grid-cols-4 @3xl:gap-2">
            {frames.slice(0, 5).map((f, i) => (
              <div key={f.image.src} className={cn(i === 0 && "col-span-2 row-span-2")}>
                <Frame frame={f} className="aspect-square" sizes={i === 0 ? "(min-width: 768px) 50vw, 100vw" : "(min-width: 768px) 25vw, 50vw"} />
              </div>
            ))}
          </div>
        </Container>
      </SectionShell>
    )
  }

  if (template === "studio") {
    // A gallery wall of plates; a swipeable strip on narrow screens.
    return (
      <SectionShell ctx={ctx} section={section} first={first}>
        <Container>
          {heading}
          <div className="rail -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 @3xl:mx-0 @3xl:grid @3xl:grid-cols-4 @3xl:gap-4 @3xl:overflow-visible @3xl:px-0 @3xl:pb-0">
            {frames.slice(0, 4).map((f, i) => (
              <div key={f.image.src} className="w-[70%] shrink-0 snap-start rounded-lg border border-line-soft bg-card p-3 @3xl:w-auto">
                <Frame frame={f} className="aspect-[4/5] rounded-md" sizes="(min-width: 768px) 24vw, 70vw" caption="none" />
                <p className="mt-3 flex items-baseline justify-between gap-3 text-xs">
                  {f.product ? (
                    <Link href={`/products/${f.product.slug}`} className="truncate text-ink-2 transition-colors hover:text-(color:--sf-accent)">{f.product.name}</Link>
                  ) : (
                    <span className="truncate text-ink-2">{ctx.brand.name}</span>
                  )}
                  <span className="shrink-0 text-ink-3 tabular">Plate {String(i + 1).padStart(2, "0")}</span>
                </p>
              </div>
            ))}
          </div>
        </Container>
      </SectionShell>
    )
  }

  // minimal: an even grid, captions underneath
  return (
    <SectionShell ctx={ctx} section={section} first={first}>
      <Container>
        {heading}
        <div className="grid grid-cols-2 gap-x-3 gap-y-6 @3xl:grid-cols-4 @3xl:gap-x-4">
          {frames.slice(0, 4).map((f) => (
            <Frame key={f.image.src} frame={f} className="aspect-[3/4]" sizes="(min-width: 768px) 24vw, 50vw" caption="below" />
          ))}
        </div>
      </Container>
    </SectionShell>
  )
}
