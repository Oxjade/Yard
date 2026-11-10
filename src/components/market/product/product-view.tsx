"use client"

import { useEffect, useId, useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { SealCheckIcon as BadgeCheck, ShoppingBagOpenIcon as ShoppingBag } from "@phosphor-icons/react"
import { AnimatePresence, motion } from "motion/react"
import { PlaceBadge } from "@/components/around/entry/place-badge"
import { RankBadge } from "@/components/charts/entry/rank-badge"
import { MessageBrandButton } from "@/components/inbox/entry"
import { SeenOnFeed } from "@/components/storefront/social/seen-on-feed"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { countries } from "@/config/markets"
import { useAsyncAction } from "@/hooks/use-async-action"
import { useHydrated } from "@/hooks/use-hydrated"
import { productStock } from "@/lib/data/products"
import { brandHref } from "@/lib/api/catalog-products"
import { duration, ease, spring } from "@/lib/motion"
import { MAX_QTY_PER_LINE, useCart } from "@/lib/stores/cart"
import { useSaved } from "@/lib/stores/saved"
import type { Brand, Drop, Product } from "@/lib/data/types"
import { BackInStockButton } from "../back-in-stock-button"
import { BrandMark } from "../brand-mark"
import { FollowButton } from "../follow-button"
import { NotifyButton } from "../notify-button"
import { Price } from "../price"
import { ProductBadge, primaryBadge } from "../product-badge"
import { WishlistButton } from "../wishlist-button"
import { DeliverySummary, ReturnsDetails, ShippingDetails } from "./delivery"
import { DropModule } from "./drop-module"
import { ProductGallery } from "./product-gallery"
import { ColourSwatches, QuantityStepper, SizeGrid, StockLine } from "./product-options"
import { SizeGuide } from "./size-guide"
import { SizeSheet } from "./size-sheet"
import { useDropPhase, useProductSelection } from "./use-product-selection"

type Action = "locked" | "closed" | "choose-size" | "sold-out" | "limit" | "ready"

const actionLabel: Record<Action, string> = {
  locked: "Not released yet",
  closed: "Entries closed",
  "choose-size": "Select a size",
  "sold-out": "Sold out",
  limit: "Add to cart",
  ready: "Add to cart",
}

/**
 * The product page body: gallery, buy box and (on phones) the floating add-to-cart bar.
 * Everything below the buy box (the rails) comes in as children so the bar can step aside
 * when the page reaches its end.
 *
 * Adding runs through useAsyncAction: the button shows a check while it succeeds and ignores
 * repeat presses meanwhile; the "Added to cart" bubble (BagPop) is the confirmation, so there is
 * no toast. Pressing "Select a size" points at the size grid instead of doing nothing.
 *
 * A piece in a draw never goes in the cart from here: before release the action is the entry
 * (NotifyButton), and after release (through its window and after it ends) entries are closed
 * and only drawn winners can buy, which needs the drops backend this build doesn't have, so the
 * button reads "Entries closed".
 */
export function ProductView({ product, brand, drop, children }: { product: Product; brand: Brand; drop: Drop | null; children?: React.ReactNode }) {
  const sel = useProductSelection(product)
  const phase = useDropPhase(drop)
  // A released draw: entries closed, and its window belongs to drawn winners only. It stays
  // closed after the window ends: no winners are drawn in this build, so nothing goes on general sale.
  const drawClosed = (phase === "live" || phase === "ended") && drop?.access === "draw"
  // The drop module explains the buy box while the drop decides it: upcoming, live, or a closed draw.
  const activeDrop = drop && (phase === "upcoming" || phase === "live" || drawClosed) ? drop : null
  const hydrated = useHydrated()
  const add = useCart((s) => s.add)
  const openBag = useCart((s) => s.open)
  const variantId = sel.variant?.id
  const inBagStored = useCart((s) => (variantId ? (s.lines.find((l) => l.variantId === variantId)?.quantity ?? 0) : 0))
  const inBag = hydrated ? inBagStored : 0

  const [sheetOpen, setSheetOpen] = useState(false)
  const [sizePrompt, setSizePrompt] = useState(false)
  const sizeLabelId = useId()
  const sizeHintId = useId()
  const sheetSizeLabelId = useId()
  const sizeGridRef = useRef<HTMLDivElement>(null)
  const sheetGridRef = useRef<HTMLDivElement>(null)

  // What can still go in the cart: stock, the 10-per-line cap and, during a live drop, its per-customer limit.
  const limit = phase === "live" && drop ? drop.limitPerCustomer : MAX_QTY_PER_LINE
  const cap = sel.stock === null ? Math.min(MAX_QTY_PER_LINE, limit) : Math.min(MAX_QTY_PER_LINE, limit, sel.stock)
  const maxQty = Math.max(0, cap - inBag)
  const qty = Math.min(sel.quantity, Math.max(1, maxQty))

  const productSoldOut = productStock(product) === 0
  const soldOut = productSoldOut || (sel.variant !== undefined && sel.stock === 0) || (sel.needsSize && sel.colourStock === 0)
  const action: Action = phase === "upcoming" ? "locked" : drawClosed ? "closed" : soldOut ? "sold-out" : sel.needsSize ? "choose-size" : maxQty === 0 ? "limit" : "ready"
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

  const adding = useAsyncAction(
    async (variantId: string, quantity: number) => {
      await add(product.id, variantId, quantity)
      sel.setQuantity(1)
      return true
    },
    { error: "That piece couldn't be added to your cart. Try again in a moment.", successFlashMs: 1200 },
  )

  /** Move focus to the first size that can be chosen, and say why. */
  function promptSize(grid: HTMLElement | null) {
    setSizePrompt(true)
    const first = grid?.querySelector<HTMLButtonElement>('[role="radio"]:not(:disabled)')
    if (!first) return
    first.focus({ preventScroll: true })
    const r = first.getBoundingClientRect()
    if (r.top < 96 || r.bottom > window.innerHeight - 120) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      first.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" })
    }
  }

  function chooseSize(size: string) {
    sel.setSize(size)
    setSizePrompt(false)
  }

  /** Resolves true once the piece is in the cart. */
  async function addToBag(grid: HTMLElement | null = sizeGridRef.current) {
    if (adding.pending || adding.succeeded) return false
    if (action === "choose-size") {
      promptSize(grid)
      return false
    }
    if (action !== "ready" || !sel.variant) return false
    return (await adding.run(sel.variant.id, qty)) === true
  }

  // Phone bar: shown once the in-page buttons have scrolled up past the header (so it never
  // covers the title on arrival), and gone once the footer comes up. Measured on scroll (not
  // IntersectionObserver) so a jump straight past the end still counts.
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
      const ctaPassed = cta.bottom < 72
      const reachedEnd = end.top < vh
      setShowBar(ctaPassed && !reachedEnd)
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
    action === "closed"
      ? `${phase === "ended" ? "This draw has ended." : "Entries closed at release."} Only drawn winners can buy, and picking winners needs the drops backend, which isn't connected in this build.`
      : action === "limit"
      ? phase === "live" && drop && cap === drop.limitPerCustomer
        ? `This drop is limited to ${drop.limitPerCustomer} per customer, and your cart already has ${inBag}.`
        : sel.stock !== null && sel.stock <= MAX_QTY_PER_LINE
          ? `All ${sel.stock} available are already in your cart.`
          : `Your cart already holds the most you can buy at once (${MAX_QTY_PER_LINE}).`
      : action === "ready" && inBag > 0
        ? `${inBag} already in your cart.`
        : action === "sold-out" && !sel.variant
          ? `Sold out for now. Save it to keep it in your wishlist, or see more from ${brand.name} below.`
          : null

  // The label changes with the selection (Select a size, Add to cart, Sold out): a short roll.
  const addButtonContent = (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={actionLabel[action]}
        initial={{ y: 12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -12, opacity: 0 }}
        transition={{ duration: duration.hover, ease: ease.out }}
        className="inline-flex items-center gap-2"
      >
        {action === "ready" ? <ShoppingBag className="size-5" /> : null}
        {actionLabel[action]}
      </motion.span>
    </AnimatePresence>
  )
  // Blocked states are disabled, except while the success check is still showing.
  const blocked = action === "locked" || action === "closed" || action === "sold-out" || action === "limit"
  const addDisabled = !adding.succeeded && blocked
  // Acid is for the action the shopper can take (add, choose a size, get notified). A blocked
  // state is not an action, so it drops to the quiet secondary slab instead of a dimmed acid one.
  const addVariant = addDisabled ? "secondary" : "primary"

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
          {/* Brand identity: the mark and name open the storefront; the line under the name adds
              the brand's place on Around and its chart position when it has them (§7.4). They're
              links of their own, so they sit beside the storefront link, not inside it. A grid, so
              that line runs under the Message and Follow buttons too and its badges don't break
              mid-phrase in a narrow buy box. */}
          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3">
            <Link href={brandHref(brand.handle)} aria-hidden tabIndex={-1} className="row-span-2 shrink-0">
              <BrandMark brand={brand} size="md" />
            </Link>
            {/* 40px tap targets on phones and tablets without moving the row (negative margins); compact beside the desktop buy box. */}
            <Link href={brandHref(brand.handle)} className="col-start-2 row-start-1 flex min-w-0 items-center gap-1.5 self-end text-sm font-medium text-ink transition-colors hover:text-violet max-lg:min-h-10 max-lg:self-center">
              <span className="truncate">{brand.name}</span>
              {brand.verified ? <BadgeCheck className="size-4 shrink-0 text-violet" aria-label="Verified brand" /> : null}
            </Link>
            <div className="col-start-3 row-start-1 flex items-center gap-3">
              {/* 40px icon with the tooltip "Message {brand}"; the brand's own Studio members see "Open Studio inbox". */}
              <MessageBrandButton brand={brand} productId={product.id} variantId={sel.variant?.id ?? null} variant="icon" className="max-lg:size-10" />
              {/* 40px on phones and tablets; the compact size beside the desktop buy box. */}
              <FollowButton brandId={brand.id} brandName={brand.name} size="sm" className="max-lg:h-10 max-lg:px-4" />
            </div>
            <span className="col-start-2 col-end-4 row-start-2 flex min-w-0 flex-wrap items-center gap-x-3 self-start text-xs text-ink-2">
              <span className="truncate">
                {brand.city}, {countries[brand.country].name}
              </span>
              <PlaceBadge brandId={brand.id} className="-my-2" />
              <RankBadge brandId={brand.id} variant="meta" className="max-lg:-my-2 max-lg:min-h-10" />
            </span>
          </div>

          <h1 className="mt-6 font-display text-display-lg text-balance break-words text-ink lg:text-display-md">{product.name}</h1>

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
                  <div ref={sizeGridRef} className="mt-3 scroll-mt-28">
                    <SizeGrid
                      sizes={sel.sizes}
                      stockBySize={sel.stockBySize}
                      value={sel.size}
                      onChange={chooseSize}
                      disabled={action === "locked" || action === "closed"}
                      layoutKey="pdp"
                      labelledBy={sizeLabelId}
                      describedBy={sizePrompt && !sel.size ? sizeHintId : undefined}
                      invalid={sizePrompt && !sel.size}
                    />
                  </div>
                  <SizeHint id={sizeHintId} show={sizePrompt && !sel.size} />
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Quantity, availability and the main action */}
          <div ref={ctaRef} className="mt-8">
            <div className="flex items-center justify-between gap-4">
              <QuantityStepper value={qty} max={maxQty} onChange={sel.setQuantity} disabled={blocked} />
              <StockLine selection={sel} locked={action === "locked"} closed={action === "closed"} className="justify-end text-right" />
            </div>
            <div className="mt-3 flex gap-2">
              {action === "locked" && activeDrop ? (
                <NotifyButton drop={activeDrop} variant="primary" size="lg" className="h-14 flex-1 text-base" />
              ) : action === "sold-out" && sel.variant && sel.stock === 0 ? (
                <BackInStockButton variantId={sel.variant.id} className="min-w-0 flex-1" />
              ) : (
                <Button
                  type="button"
                  variant={addVariant}
                  size="xl"
                  onClick={() => void addToBag()}
                  loading={adding.pending}
                  success={adding.succeeded}
                  disabled={addDisabled}
                  className="flex-1 overflow-hidden"
                >
                  {addButtonContent}
                </Button>
              )}
              <WishlistButton variant="button" productId={product.id} name={product.name} />
            </div>
            <AnimatePresence initial={false}>
              {helper ? (
                <motion.p
                  key="helper"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, transition: { duration: duration.press, ease: ease.in } }}
                  transition={{ duration: duration.hover, ease: ease.out }}
                  className="mt-3 text-xs text-ink-2"
                  aria-live="polite"
                >
                  {helper}{" "}
                  {inBag > 0 ? (
                    // A 40px target that keeps the line's height (negative margin, as the breadcrumb does).
                    <button type="button" onClick={openBag} className="-my-3 inline-flex min-h-10 items-center rounded-md text-violet underline-offset-4 hover:underline">
                      View cart
                    </button>
                  ) : null}
                </motion.p>
              ) : null}
            </AnimatePresence>
          </div>

          <div className="mt-8">
            <DeliverySummary brand={brand} product={product} drop={drop} variantId={sel.variant?.id ?? null} status={action === "locked" ? "unreleased" : action === "sold-out" || action === "closed" ? "unavailable" : "available"} />
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

          {/* Posts by the brand that tag this piece (§7.4). Renders nothing while loading or when none do. */}
          <SeenOnFeed brandId={brand.id} productId={product.id} brandName={brand.name} className="mt-10" />
        </div>
      </div>

      {children}
      <div ref={endRef} aria-hidden className="h-px" />

      {/* Phone: floating add-to-cart bar, clear of the home bar and its raised pin */}
      <AnimatePresence>
        {showBar ? (
          <motion.div
            key="pdp-bar"
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={spring.snappy}
            className="fixed inset-x-0 bottom-(--tabbar-clear) z-30 px-3 lg:hidden"
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
                  View cart
                </Button>
              ) : (
                <Button
                  type="button"
                  variant={addVariant}
                  size="lg"
                  className="h-11 overflow-hidden px-4"
                  onClick={() => void addToBag()}
                  loading={adding.pending}
                  success={adding.succeeded}
                  disabled={addDisabled}
                >
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
                <StockLine selection={sel} locked={action === "locked"} closed={action === "closed"} />
                <SizeGuide sizes={sel.sizes} selected={sel.size} brandName={brand.name} fitNote={fitNote} />
              </div>
              <Button
                type="button"
                variant={addVariant}
                size="xl"
                className="w-full overflow-hidden"
                loading={adding.pending}
                disabled={addDisabled}
                onClick={async () => {
                  // The sheet closes on success; the "Added to cart" bubble confirms.
                  if (await addToBag(sheetGridRef.current)) setSheetOpen(false)
                }}
              >
                {addButtonContent}
              </Button>
            </>
          }
        >
          <div ref={sheetGridRef}>
            <SizeGrid
              sizes={sel.sizes}
              stockBySize={sel.stockBySize}
              value={sel.size}
              onChange={chooseSize}
              layoutKey="sheet"
              labelledBy={sheetSizeLabelId}
              describedBy={sizePrompt && !sel.size ? `${sizeHintId}-sheet` : undefined}
              invalid={sizePrompt && !sel.size}
            />
          </div>
          <SizeHint id={`${sizeHintId}-sheet`} show={sizePrompt && !sel.size} />
        </SizeSheet>
      ) : null}
    </>
  )
}

/** "Choose a size" under the size grid, shown after Add to cart was pressed without one. */
function SizeHint({ id, show }: { id: string; show: boolean }) {
  return (
    <AnimatePresence initial={false}>
      {show ? (
        <motion.p
          key="hint"
          id={id}
          role="alert"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: duration.press, ease: ease.in } }}
          transition={{ duration: duration.hover, ease: ease.out }}
          className="mt-2 text-xs text-danger"
        >
          Choose a size to add this to your cart.
        </motion.p>
      ) : null}
    </AnimatePresence>
  )
}
