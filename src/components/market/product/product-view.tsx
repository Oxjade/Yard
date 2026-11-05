"use client"

import { useEffect, useId, useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { BadgeCheck, Check, ShoppingBag } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { countries } from "@/config/markets"
import { useHydrated } from "@/hooks/use-hydrated"
import { productStock, variantLabel } from "@/lib/data/products"
import { MAX_QTY_PER_LINE, useCart } from "@/lib/stores/cart"
import { useSaved } from "@/lib/stores/saved"
import type { Brand, Drop, Product } from "@/lib/data/types"
import { BrandMark } from "../brand-mark"
import { FollowButton } from "../follow-button"
import { NotifyButton } from "../notify-button"
import { Price } from "../price"
import { ProductBadge, primaryBadge } from "../product-badge"
import { addedToast } from "../quick-add"
import { WishlistButton } from "../wishlist-button"
import { DeliverySummary, ReturnsDetails, ShippingDetails } from "./delivery"
import { DropModule } from "./drop-module"
import { ProductGallery } from "./product-gallery"
import { ColourSwatches, QuantityStepper, SizeGrid, StockLine } from "./product-options"
import { SizeGuide } from "./size-guide"
import { SizeSheet } from "./size-sheet"
import { useDropPhase, useProductSelection } from "./use-product-selection"

type Action = "locked" | "choose-size" | "sold-out" | "limit" | "ready"

const actionLabel: Record<Action, string> = {
  locked: "Not released yet",
  "choose-size": "Select a size",
  "sold-out": "Sold out",
  limit: "Add to bag",
  ready: "Add to bag",
}

/**
 * The product page body: gallery, buy box and (on phones) the floating add-to-bag bar.
 * Everything below the buy box (the rails) comes in as children so the bar can step aside
 * when the page reaches its end.
 */
export function ProductView({ product, brand, drop, children }: { product: Product; brand: Brand; drop: Drop | null; children?: React.ReactNode }) {
  const sel = useProductSelection(product)
  const phase = useDropPhase(drop)
  const activeDrop = drop && (phase === "upcoming" || phase === "live") ? drop : null
  const hydrated = useHydrated()
  const add = useCart((s) => s.add)
  const openBag = useCart((s) => s.open)
  const variantId = sel.variant?.id
  const inBagStored = useCart((s) => (variantId ? (s.lines.find((l) => l.variantId === variantId)?.quantity ?? 0) : 0))
  const inBag = hydrated ? inBagStored : 0

  const [justAdded, setJustAdded] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const addedTimer = useRef<number | undefined>(undefined)
  const sizeLabelId = useId()
  const sheetSizeLabelId = useId()

  // What can still go in the bag: stock, the 10-per-line cap and, during a live drop, its per-customer limit.
  const limit = phase === "live" && drop ? drop.limitPerCustomer : MAX_QTY_PER_LINE
  const cap = sel.stock === null ? Math.min(MAX_QTY_PER_LINE, limit) : Math.min(MAX_QTY_PER_LINE, limit, sel.stock)
  const maxQty = Math.max(0, cap - inBag)
  const qty = Math.min(sel.quantity, Math.max(1, maxQty))

  const productSoldOut = productStock(product) === 0
  const soldOut = productSoldOut || (sel.variant !== undefined && sel.stock === 0) || (sel.needsSize && sel.colourStock === 0)
  const action: Action = phase === "upcoming" ? "locked" : soldOut ? "sold-out" : sel.needsSize ? "choose-size" : maxQty === 0 ? "limit" : "ready"
  const fitNote = product.details.find((d) => /\bfit\b|size down|size up|true to size/i.test(d))
  // One status badge over the image, picked like ProductCard's; the sale signal stays beside the price.
  const overlayBadge = primaryBadge({ badges: product.badges, compareAt: undefined })

  // Record the view once the saved store has been read from storage, so the write isn't overwritten.
  useEffect(() => {
    const record = () => useSaved.getState().viewed(product.id)
    if (useSaved.persist.hasHydrated()) {
      record()
      return
    }
    return useSaved.persist.onFinishHydration(record)
  }, [product.id])

  useEffect(() => () => window.clearTimeout(addedTimer.current), [])

  function addToBag() {
    if (action !== "ready" || !sel.variant) return false
    add(product.id, sel.variant.id, qty)
    addedToast(product, [variantLabel(sel.variant.options), qty > 1 ? `quantity ${qty}` : ""].filter(Boolean).join(", "))
    sel.setQuantity(1)
    setJustAdded(true)
    window.clearTimeout(addedTimer.current)
    addedTimer.current = window.setTimeout(() => setJustAdded(false), 1600)
    return true
  }

  // Phone bar: shown while the in-page buttons are off screen, and gone once the footer comes up.
  // Measured on scroll (not IntersectionObserver) so a jump straight past the end still counts.
  const ctaRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const [showBar, setShowBar] = useState(false)
  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      const cta = ctaRef.current?.getBoundingClientRect()
      const end = endRef.current?.getBoundingClientRect()
      if (!cta || !end) return
      const vh = window.innerHeight
      const ctaOnScreen = cta.bottom > 0 && cta.top < vh
      const reachedEnd = end.top < vh
      setShowBar(!ctaOnScreen && !reachedEnd)
    }
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update)
    }
    update()
    window.addEventListener("scroll", schedule, { passive: true })
    window.addEventListener("resize", schedule)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener("scroll", schedule)
      window.removeEventListener("resize", schedule)
    }
  }, [])

  const helper =
    action === "limit"
      ? phase === "live" && drop && cap === drop.limitPerCustomer
        ? `This drop is limited to ${drop.limitPerCustomer} per customer, and your bag already has ${inBag}.`
        : sel.stock !== null && sel.stock <= MAX_QTY_PER_LINE
          ? `All ${sel.stock} available are already in your bag.`
          : `Your bag already holds the most you can buy at once (${MAX_QTY_PER_LINE}).`
      : action === "ready" && inBag > 0
        ? `${inBag} already in your bag.`
        : action === "sold-out" && (productSoldOut || !sel.sizes.length)
          ? `Sold out for now. Save it to keep it in your wishlist, or see more from ${brand.name} below.`
          : null

  const addButtonContent = (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={justAdded ? "added" : actionLabel[action]}
        initial={{ y: 14, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -14, opacity: 0 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="inline-flex items-center gap-2"
      >
        {justAdded ? <Check className="size-5" /> : action === "ready" ? <ShoppingBag className="size-5" /> : null}
        {justAdded ? "Added to bag" : actionLabel[action]}
      </motion.span>
    </AnimatePresence>
  )

  return (
    <>
      <div className="mt-4 md:mt-6 md:grid md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:items-start md:gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(360px,1fr)] lg:gap-14 xl:gap-20">
        <div className="md:sticky md:top-24">
          <ProductGallery
            images={product.images}
            name={product.name}
            overlay={
              productSoldOut ? (
                <span className="glass inline-flex h-6 items-center rounded-[5px] px-2 text-[11px] text-ink-2">Sold out</span>
              ) : overlayBadge ? (
                <ProductBadge kind={overlayBadge} />
              ) : null
            }
          />
        </div>

        <div className="mt-6 md:mt-0">
          {/* Brand identity */}
          <div className="flex items-center gap-3">
            <Link href={`/brands/${brand.handle}`} className="group flex min-w-0 flex-1 items-center gap-3">
              <BrandMark brand={brand} size="md" />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-medium text-ink transition-colors group-hover:text-violet">
                  <span className="truncate">{brand.name}</span>
                  {brand.verified ? <BadgeCheck className="size-4 shrink-0 text-violet" aria-label="Verified brand" /> : null}
                </span>
                <span className="block truncate text-xs text-ink-2">
                  {brand.city}, {countries[brand.country].name}
                </span>
              </span>
            </Link>
            <FollowButton brandId={brand.id} brandName={brand.name} size="sm" />
          </div>

          <h1 className="mt-6 font-display text-display-lg text-balance text-ink lg:text-display-md">{product.name}</h1>

          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
            <Price amount={product.price} currency={product.currency} compareAt={product.compareAt} size="lg" />
            {product.compareAt ? <ProductBadge kind="sale" /> : null}
          </div>
          <p className="mt-1.5 text-xs text-ink-3">Duties and taxes are confirmed at checkout.</p>

          <p className="mt-5 max-w-prose text-pretty text-[0.9375rem] leading-relaxed text-ink-2">{product.description}</p>

          {activeDrop && phase ? (
            <div className="mt-6">
              <DropModule drop={activeDrop} phase={phase} />
            </div>
          ) : null}

          {sel.colours.length || sel.sizes.length ? (
            <div className="mt-8 grid gap-7">
              {sel.colours.length ? (
                <ColourSwatches colours={sel.colours} value={sel.colour} onChange={sel.setColour} hasStock={sel.colourHasStock} layoutKey="pdp" />
              ) : null}
              {sel.sizes.length ? (
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <p id={sizeLabelId} className="text-sm text-ink-2">
                      Size {sel.size ? <span className="ml-1 text-ink">{sel.size}</span> : null}
                    </p>
                    <SizeGuide sizes={sel.sizes} selected={sel.size} brandName={brand.name} fitNote={fitNote} />
                  </div>
                  <div className="mt-3">
                    <SizeGrid sizes={sel.sizes} stockBySize={sel.stockBySize} value={sel.size} onChange={sel.setSize} disabled={action === "locked"} layoutKey="pdp" labelledBy={sizeLabelId} />
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Quantity, availability and the main action */}
          <div ref={ctaRef} className="mt-8">
            <div className="flex items-center justify-between gap-4">
              <QuantityStepper value={qty} max={maxQty} onChange={sel.setQuantity} disabled={action === "locked" || action === "sold-out" || action === "limit"} />
              <StockLine selection={sel} className="justify-end text-right" />
            </div>
            <div className="mt-3 flex gap-2">
              {action === "locked" && activeDrop ? (
                <NotifyButton drop={activeDrop} variant="primary" size="lg" className="h-14 flex-1 text-base" />
              ) : (
                <Button type="button" variant="primary" size="xl" onClick={addToBag} disabled={action !== "ready" && !justAdded} className="flex-1 overflow-hidden">
                  {addButtonContent}
                </Button>
              )}
              <WishlistButton variant="button" productId={product.id} name={product.name} />
            </div>
            {helper ? (
              <p className="mt-3 text-xs text-ink-2">
                {helper}{" "}
                {inBag > 0 ? (
                  <button type="button" onClick={openBag} className="text-violet underline-offset-4 hover:underline">
                    View bag
                  </button>
                ) : null}
              </p>
            ) : null}
          </div>

          <div className="mt-8">
            <DeliverySummary brand={brand} status={action === "locked" ? "unreleased" : action === "sold-out" ? "unavailable" : "available"} />
          </div>

          <section aria-labelledby="pdp-info-title" className="mt-8">
            <h2 id="pdp-info-title" className="sr-only">
              Product information
            </h2>
            <Accordion type="multiple" defaultValue={["details"]} className="border-t border-line">
              <AccordionItem value="details" className="border-line">
                <AccordionTrigger className="py-4 text-[0.9375rem] text-ink hover:no-underline">Details</AccordionTrigger>
                <AccordionContent className="pb-5">
                  <ul className="grid gap-2 text-sm text-ink-2">
                    {product.details.map((d) => (
                      <li key={d} className="flex gap-3">
                        <span className="mt-2 size-1 shrink-0 rounded-full bg-ink-3" aria-hidden />
                        {d}
                      </li>
                    ))}
                  </ul>
                  {sel.variant ? <p className="mt-4 text-xs text-ink-3 tabular">Reference {sel.variant.sku}</p> : null}
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="shipping" className="border-line">
                <AccordionTrigger className="py-4 text-[0.9375rem] text-ink hover:no-underline">Shipping</AccordionTrigger>
                <AccordionContent className="pb-5">
                  <ShippingDetails brand={brand} product={product} />
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="returns" className="border-line">
                <AccordionTrigger className="py-4 text-[0.9375rem] text-ink hover:no-underline">Returns</AccordionTrigger>
                <AccordionContent className="pb-5">
                  <ReturnsDetails brand={brand} />
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </section>
        </div>
      </div>

      {children}
      <div ref={endRef} aria-hidden className="h-px" />

      {/* Phone: floating add-to-bag bar above the tab bar */}
      <AnimatePresence>
        {showBar ? (
          <motion.div
            key="pdp-bar"
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 36 }}
            className="fixed inset-x-0 bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+4.75rem)] z-30 px-3 lg:hidden"
          >
            <div className="glass glass-sheen mx-auto flex max-w-md items-center gap-3 rounded-2xl p-2">
              <div className="relative h-12 w-10 shrink-0 overflow-hidden rounded-md bg-card">
                <Image src={product.images[0].src} alt="" fill sizes="40px" className="object-cover" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink">{product.name}</p>
                <p className="flex items-center gap-2 text-xs text-ink-2">
                  <Price amount={product.price} currency={product.currency} compareAt={product.compareAt} className="text-xs" />
                  {sel.size ? <span className="truncate">Size {sel.size}</span> : null}
                </p>
              </div>
              {action === "locked" && activeDrop ? (
                <NotifyButton drop={activeDrop} variant="primary" size="lg" className="h-11 px-4" />
              ) : action === "choose-size" ? (
                <Button type="button" variant="primary" size="lg" className="h-11 px-4" onClick={() => setSheetOpen(true)}>
                  Select a size
                </Button>
              ) : action === "limit" ? (
                <Button type="button" variant="primary" size="lg" className="h-11 px-4" onClick={openBag}>
                  View bag
                </Button>
              ) : (
                <Button type="button" variant="primary" size="lg" className="h-11 overflow-hidden px-4" onClick={addToBag} disabled={action !== "ready" && !justAdded}>
                  {addButtonContent}
                </Button>
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Phone: size sheet opened from the bar */}
      {sel.sizes.length ? (
        <SizeSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          title="Select a size"
          titleId={sheetSizeLabelId}
          description={`${product.name}${sel.colour ? `, ${sel.colour}` : ""}`}
          footer={
            <>
              <div className="flex items-center justify-between gap-3">
                <StockLine selection={sel} />
                <SizeGuide sizes={sel.sizes} selected={sel.size} brandName={brand.name} fitNote={fitNote} />
              </div>
              <Button
                type="button"
                variant="primary"
                size="xl"
                className="w-full overflow-hidden"
                disabled={action !== "ready"}
                onClick={() => {
                  if (addToBag()) setSheetOpen(false)
                }}
              >
                {addButtonContent}
              </Button>
            </>
          }
        >
          <SizeGrid sizes={sel.sizes} stockBySize={sel.stockBySize} value={sel.size} onChange={sel.setSize} layoutKey="sheet" labelledBy={sheetSizeLabelId} />
        </SizeSheet>
      ) : null}
    </>
  )
}
