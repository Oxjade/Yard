"use client"

import Image from "next/image"
import Link from "next/link"
import { MinusIcon as Minus, PlusIcon as Plus, TruckIcon as Truck, XIcon as X } from "@phosphor-icons/react"
import { AnimatePresence, motion } from "motion/react"
import { countries } from "@/config/markets"
import { variantLabel } from "@/lib/data/products"
import { formatMoney } from "@/lib/money"
import { useCart } from "@/lib/stores/cart"
import { cn } from "@/lib/utils"
import type { BrandGroup } from "@/lib/cart"
import type { CurrencyCode } from "@/config/markets"
import { BrandMark } from "./brand-mark"

/** Bag lines grouped by brand — shared by the bag drawer and the bag page. */
export function BagGroups({ groups, currency, compact = false, onNavigate }: { groups: BrandGroup[]; currency: CurrencyCode; compact?: boolean; onNavigate?: () => void }) {
  const setQuantity = useCart((s) => s.setQuantity)
  const remove = useCart((s) => s.remove)

  return (
    <div className="flex flex-col gap-4">
      <AnimatePresence initial={false}>
        {groups.map((g) => (
          <motion.section
            key={g.brand.id}
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0 }}
            className={cn("overflow-hidden rounded-xl border border-white/8", compact ? "bg-white/[0.02]" : "bg-card")}
            aria-label={`Items from ${g.brand.name}`}
          >
            <header className="flex items-center justify-between gap-3 border-b border-white/6 px-4 py-3">
              <Link href={`/brands/${g.brand.handle}`} onClick={onNavigate} className="flex min-w-0 items-center gap-2.5">
                <BrandMark brand={g.brand} size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink">{g.brand.name}</p>
                  <p className="truncate text-xs text-ink-2">Ships from {g.brand.city}, {countries[g.brand.shipsFrom].name}</p>
                </div>
              </Link>
              <p className="shrink-0 text-xs text-ink-2 tabular">{g.days[0]}–{g.days[1]} days</p>
            </header>
            <ul className="divide-y divide-white/6">
              <AnimatePresence initial={false}>
                {g.lines.map((l) => (
                  <motion.li key={l.variant.id} layout exit={{ opacity: 0, x: 24 }} className="flex gap-3 px-4 py-3">
                    <Link href={`/products/${l.product.slug}`} onClick={onNavigate} className={cn("relative shrink-0 overflow-hidden rounded-md bg-surface", compact ? "h-20 w-16" : "h-28 w-22")}>
                      <Image src={l.product.images[0].src} alt={l.product.images[0].alt} fill sizes="96px" className="object-cover" />
                    </Link>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Link href={`/products/${l.product.slug}`} onClick={onNavigate} className="block truncate text-sm text-ink">{l.product.name}</Link>
                          <p className="truncate text-xs text-ink-2">{variantLabel(l.variant.options)}</p>
                        </div>
                        <button type="button" onClick={() => remove(l.variant.id)} aria-label={`Remove ${l.product.name}`} className="-mt-1 -mr-1 inline-flex size-7 items-center justify-center rounded-md text-ink-3 transition hover:bg-elevated hover:text-ink">
                          <X className="size-4" />
                        </button>
                      </div>
                      <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                        <div className="inline-flex h-8 items-center rounded-md border border-line" role="group" aria-label="Quantity">
                          <button type="button" onClick={() => setQuantity(l.variant.id, l.line.quantity - 1)} aria-label="Decrease quantity" className="inline-flex size-8 items-center justify-center text-ink-2 hover:text-ink">
                            <Minus className="size-3.5" />
                          </button>
                          <span className="w-6 text-center text-sm tabular" aria-live="polite">{l.line.quantity}</span>
                          <button type="button" onClick={() => setQuantity(l.variant.id, l.line.quantity + 1)} disabled={l.line.quantity >= l.maxQty} aria-label="Increase quantity" className="inline-flex size-8 items-center justify-center text-ink-2 hover:text-ink disabled:opacity-30">
                            <Plus className="size-3.5" />
                          </button>
                        </div>
                        <motion.p key={l.total} initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} className="text-sm tabular">
                          {formatMoney(l.total, currency)}
                        </motion.p>
                      </div>
                      {l.line.quantity >= l.maxQty && l.maxQty < 10 ? <p className="mt-1 text-[11px] text-acid">Only {l.maxQty} available</p> : null}
                    </div>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
            <footer className="flex items-center justify-between gap-3 border-t border-white/6 px-4 py-2.5 text-xs">
              <span className="flex items-center gap-1.5 text-ink-2">
                <Truck className="size-3.5" />
                {g.freeShipping ? "Free standard shipping" : `${formatMoney(g.toFreeShipping, currency)} more for free shipping`}
              </span>
              <span className="tabular text-ink">{g.freeShipping ? "Free" : formatMoney(g.shipping, currency)}</span>
            </footer>
          </motion.section>
        ))}
      </AnimatePresence>
    </div>
  )
}
