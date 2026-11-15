"use client"

import { useRef } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ShoppingBagOpenIcon as ShoppingBag, XIcon as X } from "@phosphor-icons/react"
import { AnimatePresence, motion, useDragControls, type PanInfo } from "motion/react"
import { spring, transition } from "@/lib/motion"
import { Dialog as DialogPrimitive } from "radix-ui"
import { Button } from "@/components/ui/button"
import { RollNumber } from "@/components/ui/roll-number"
import { canTakeFocus, useFocusReturn } from "@/components/ui/dialog"
import { priceCart } from "@/lib/cart"
import { formatMoney } from "@/lib/money"
import { useCart } from "@/lib/stores/cart"
import { useSession } from "@/lib/stores/session"
import { BagGroups } from "./bag-contents"
import { bagCount } from "./bag-count"
import { BrandDeliveryList, ShippingAmount } from "./delivery/delivery-bits"
import { useShippingQuote } from "./delivery/use-shipping-quote"

/**
 * The Cart button that can take focus right now: the header's on desktop, the home bar's on phones
 * (only one is visible at a time). Where focus lands when whatever opened the drawer (or the
 * sign-in prompt) has gone.
 */
export const bagButton = () => Array.from(document.querySelectorAll<HTMLElement>('header button[aria-label^="Cart,"], nav[aria-label="Primary"] button[aria-label^="Cart,"]')).find(canTakeFocus)

/**
 * The cart drawer: a floating Liquid Glass panel that springs in from the right. Its header is a
 * handle: swipe it to the right to put the drawer away (the same distance and flick speed as
 * PhoneSheet's drag down); the close button, Escape and an outside press still work. On close,
 * focus goes back to what opened it (the Cart button in the header or the home bar, a product's
 * "View cart"), or to the visible Cart button when that control has gone (the "Added to cart"
 * bubble, a toast's action).
 */
export function BagDrawer() {
  const router = useRouter()
  const isOpen = useCart((s) => s.isOpen)
  const setOpen = useCart((s) => s.setOpen)
  const lines = useCart((s) => s.lines)
  const unavailable = useCart((s) => s.unavailable.length)
  const currency = useSession((s) => s.currency)
  const shipTo = useSession((s) => s.shipTo)
  const shipToCity = useSession((s) => s.shipToCity)
  const requireAuth = useSession((s) => s.requireAuth)
  // The quote loads only while the drawer is open; shipping comes from it alone (§6.5).
  const quote = useShippingQuote(lines, shipTo, shipToCity, currency, { enabled: isOpen })
  const bag = priceCart(lines, shipTo, currency, quote.quotes)
  const quoteFailed = !quote.isLoading && !!quote.error
  const count = bagCount(lines)
  const drag = useDragControls()
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x > 96 || info.velocity.x > 600) setOpen(false)
  }
  const close = () => setOpen(false)
  const focus = useFocusReturn(bagButton)
  // Removing the last line moves focus to the empty state's title (see BagGroups).
  const emptyTitle = useRef<HTMLParagraphElement>(null)

  function checkout() {
    if (bag.notForSaleBlock) return
    const go = () => {
      setOpen(false)
      router.push("/checkout")
    }
    if (requireAuth("checkout", go)) go()
  }

  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={setOpen}>
      <AnimatePresence>
        {isOpen ? (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[6px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={transition.scrim}
              />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content asChild forceMount aria-describedby={undefined} onCloseAutoFocus={focus.onCloseAutoFocus}>
              <motion.div
                className="glass-sheet glass-sheen fixed inset-y-2 right-2 z-50 flex w-[calc(100%-1rem)] max-w-[440px] flex-col overflow-hidden rounded-2xl outline-none sm:inset-y-3 sm:right-3"
                initial={{ x: "105%" }}
                animate={{ x: 0 }}
                exit={{ x: "105%" }}
                transition={transition.sheet}
                drag="x"
                dragControls={drag}
                dragListener={false}
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={{ left: 0, right: 0.7 }}
                onDragEnd={onDragEnd}
              >
                {focus.probe}
                <header
                  className="flex touch-pan-y items-center justify-between px-5 pt-5 pb-4 select-none"
                  onPointerDown={(e) => {
                    if ((e.target as Element).closest("button, a")) return
                    drag.start(e)
                  }}
                >
                  <DialogPrimitive.Title className="flex items-baseline gap-2">
                    <span className="font-display text-display-sm">Cart</span>
                    <span className="inline-flex text-sm text-ink-2 tabular">
                      <span className="sr-only">{count}</span>
                      <RollNumber value={count} />
                      &nbsp;{count === 1 ? "item" : "items"}
                    </span>
                  </DialogPrimitive.Title>
                  <DialogPrimitive.Close className="press -mr-1 inline-flex size-10 items-center justify-center rounded-full text-ink-2 hover:bg-white/8 hover:text-ink" aria-label="Close cart">
                    <X className="size-5" />
                  </DialogPrimitive.Close>
                </header>
                {/* Pieces the shop no longer sells; the cart page lists them with Remove. */}
                {unavailable ? (
                  <p className="mx-5 mb-3 text-xs text-ink-2">
                    {unavailable === 1 ? "1 piece" : `${unavailable} pieces`} from your cart {unavailable === 1 ? "is" : "are"} no longer available.{" "}
                    <Link href="/bag" onClick={close} className="text-violet underline-offset-2 hover:underline">
                      See your cart
                    </Link>
                  </p>
                ) : null}

                {bag.groups.length === 0 ? (
                  // The last line leaving (or an empty cart opening) settles the empty state in.
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring.reveal} className="flex flex-1 flex-col items-center justify-center gap-4 px-8 pb-16 text-center">
                    <span className="inline-flex size-14 items-center justify-center rounded-full border border-white/10">
                      <ShoppingBag className="size-6 text-ink-2" />
                    </span>
                    <div>
                      <p ref={emptyTitle} tabIndex={-1} className="text-base text-ink outline-none">
                        Your cart is empty
                      </p>
                      <p className="mt-1 text-sm text-ink-2">Add pieces from any brand and they check out together, one order per brand.</p>
                    </div>
                    <Button asChild variant="primary" onClick={close}>
                      <Link href="/brands">Discover brands</Link>
                    </Button>
                  </motion.div>
                ) : (
                  <>
                    <div className="flex-1 overflow-y-auto px-3 pb-4 sm:px-4">
                      {bag.groups.length > 1 ? (
                        <p className="mb-3 px-1 text-xs text-ink-2">
                          {bag.groups.length} brands, one checkout. Each brand ships its own order.
                        </p>
                      ) : null}
                      {/* Each brand's section shows its day count and shipping line once its own quote has loaded (§6.5). */}
                      <BagGroups groups={bag.groups} currency={currency} compact onNavigate={close} focusWhenEmpty={emptyTitle} />
                      <BrandDeliveryList groups={bag.groups} state={quote} className="mt-4 px-1" title="Estimated delivery by brand" />
                    </div>
                    <footer data-toast-avoid="" className="border-t border-white/8 bg-black/20 px-5 pt-4 pb-[max(1.25rem,calc(env(safe-area-inset-bottom)-0.5rem))]">
                      <dl className="space-y-1.5 text-sm">
                        <div className="flex items-center justify-between gap-3 text-ink-2">
                          <dt>Subtotal</dt>
                          <dd className="tabular text-ink">
                            <span className="sr-only">{formatMoney(bag.subtotal, currency)}</span>
                            <RollNumber value={bag.subtotal}>{formatMoney(bag.subtotal, currency)}</RollNumber>
                          </dd>
                        </div>
                        <div className="flex min-h-5 items-center justify-between gap-3 text-ink-2">
                          <dt>Shipping, {bag.groups.length} {bag.groups.length === 1 ? "brand" : "brands"}</dt>
                          <dd className="tabular text-ink">
                            <ShippingAmount amount={bag.shipping} currency={currency} state={quote} unavailable={bag.blocked.length > 0} />
                          </dd>
                        </div>
                        {bag.total !== null ? (
                          <div className="flex items-center justify-between gap-3 border-t border-white/8 pt-1.5 text-ink">
                            <dt>Total</dt>
                            <dd className="tabular">
                              <span className="sr-only">{formatMoney(bag.total, currency)}</span>
                              <RollNumber value={bag.total}>{formatMoney(bag.total, currency)}</RollNumber>
                            </dd>
                          </div>
                        ) : null}
                      </dl>
                      <p className="mt-2 text-xs text-ink-3">
                        {quoteFailed ? "Shipping is calculated at checkout. " : ""}Taxes aren&apos;t calculated in this build; import duties, if any, are collected by the courier.
                      </p>
                      <div className="mt-4 grid gap-2">
                        {bag.notForSaleBlock ? (
                          <p id="drawer-checkout-block" role="status" className="text-xs break-words text-acid">
                            {bag.notForSaleBlock}
                          </p>
                        ) : null}
                        <Button variant="primary" size="lg" onClick={checkout} disabled={!!bag.notForSaleBlock} aria-describedby={bag.notForSaleBlock ? "drawer-checkout-block" : undefined} className="w-full">
                          Checkout
                        </Button>
                        <Button asChild variant="secondary" size="lg" onClick={close} className="w-full">
                          <Link href="/bag">View cart</Link>
                        </Button>
                      </div>
                    </footer>
                  </>
                )}
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        ) : null}
      </AnimatePresence>
    </DialogPrimitive.Root>
  )
}
