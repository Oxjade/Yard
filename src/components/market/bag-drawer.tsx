"use client"

import { useRef } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ShoppingBagOpenIcon as ShoppingBag, XIcon as X } from "@phosphor-icons/react"
import { AnimatePresence, motion } from "motion/react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { Button } from "@/components/ui/button"
import { canTakeFocus, useFocusReturn } from "@/components/ui/dialog"
import { priceCart } from "@/lib/cart"
import { formatMoney } from "@/lib/money"
import { useCart } from "@/lib/stores/cart"
import { useSession } from "@/lib/stores/session"
import { BagGroups } from "./bag-contents"
import { bagCount } from "./bag-count"

/** The header's bag button: where focus lands when whatever opened the drawer (or the sign-in prompt) has gone. */
export const bagButton = () => Array.from(document.querySelectorAll<HTMLElement>('header button[aria-label^="Bag,"]')).find(canTakeFocus)

/**
 * The bag drawer: a floating Liquid Glass panel that springs in from the right. On close,
 * focus goes back to what opened it (the bag button, a product's "View bag"), or to the bag
 * button when that control has gone (the "Added to bag" bubble, a toast's action).
 */
export function BagDrawer() {
  const router = useRouter()
  const isOpen = useCart((s) => s.isOpen)
  const setOpen = useCart((s) => s.setOpen)
  const lines = useCart((s) => s.lines)
  const currency = useSession((s) => s.currency)
  const shipTo = useSession((s) => s.shipTo)
  const requireAuth = useSession((s) => s.requireAuth)
  const bag = priceCart(lines, shipTo, currency)
  const count = bagCount(lines)
  const close = () => setOpen(false)
  const focus = useFocusReturn(bagButton)
  // Removing the last line moves focus to the empty state's title (see BagGroups).
  const emptyTitle = useRef<HTMLParagraphElement>(null)

  function checkout() {
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
                transition={{ duration: 0.25 }}
              />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content asChild forceMount aria-describedby={undefined} onCloseAutoFocus={focus.onCloseAutoFocus}>
              <motion.div
                className="glass-strong glass-sheen fixed inset-y-2 right-2 z-50 flex w-[calc(100%-1rem)] max-w-[440px] flex-col overflow-hidden rounded-2xl outline-none sm:inset-y-3 sm:right-3"
                initial={{ x: "105%" }}
                animate={{ x: 0 }}
                exit={{ x: "105%" }}
                transition={{ type: "spring", stiffness: 380, damping: 36, mass: 0.9 }}
              >
                {focus.probe}
                <header className="flex items-center justify-between px-5 pt-5 pb-4">
                  <DialogPrimitive.Title className="flex items-baseline gap-2">
                    <span className="font-display text-display-sm">Bag</span>
                    <span className="text-sm text-ink-2 tabular">{count} {count === 1 ? "item" : "items"}</span>
                  </DialogPrimitive.Title>
                  <DialogPrimitive.Close className="inline-flex size-9 items-center justify-center rounded-full text-ink-2 transition hover:bg-white/8 hover:text-ink" aria-label="Close bag">
                    <X className="size-5" />
                  </DialogPrimitive.Close>
                </header>

                {bag.groups.length === 0 ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 pb-16 text-center">
                    <span className="inline-flex size-14 items-center justify-center rounded-full border border-white/10">
                      <ShoppingBag className="size-6 text-ink-2" />
                    </span>
                    <div>
                      <p ref={emptyTitle} tabIndex={-1} className="text-base text-ink outline-none">
                        Your bag is empty
                      </p>
                      <p className="mt-1 text-sm text-ink-2">Add pieces from any brand and they check out together, one order per brand.</p>
                    </div>
                    <Button asChild variant="primary" onClick={close}>
                      <Link href="/brands">Discover brands</Link>
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="flex-1 overflow-y-auto px-3 pb-4 sm:px-4">
                      {bag.groups.length > 1 ? (
                        <p className="mb-3 px-1 text-xs text-ink-2">
                          {bag.groups.length} brands, one checkout. Each brand ships its own order.
                        </p>
                      ) : null}
                      <BagGroups groups={bag.groups} currency={currency} compact onNavigate={close} focusWhenEmpty={emptyTitle} />
                    </div>
                    <footer data-toast-avoid="" className="border-t border-white/8 bg-black/20 px-5 pt-4 pb-5">
                      <dl className="space-y-1.5 text-sm">
                        <div className="flex justify-between text-ink-2">
                          <dt>Subtotal</dt>
                          <dd className="tabular text-ink">{formatMoney(bag.subtotal, currency)}</dd>
                        </div>
                        <div className="flex justify-between text-ink-2">
                          <dt>Shipping, {bag.groups.length} {bag.groups.length === 1 ? "brand" : "brands"}</dt>
                          <dd className="tabular text-ink">{bag.shipping === 0 ? "Free" : formatMoney(bag.shipping, currency)}</dd>
                        </div>
                      </dl>
                      <p className="mt-2 text-xs text-ink-3">Taxes and duties are confirmed at checkout.</p>
                      <div className="mt-4 grid gap-2">
                        <Button variant="primary" size="lg" onClick={checkout} className="w-full">
                          Checkout
                        </Button>
                        <Button asChild variant="secondary" size="lg" onClick={close} className="w-full">
                          <Link href="/bag">View bag</Link>
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
