"use client"

import { useRef } from "react"
import Image from "next/image"
import Link from "next/link"
import { MinusIcon as Minus, PlusIcon as Plus, TruckIcon as Truck, XIcon as X } from "@phosphor-icons/react"
import { AnimatePresence, LayoutGroup, motion, useIsPresent } from "motion/react"
import { countries } from "@/config/markets"
import { variantLabel } from "@/lib/data/products"
import { formatMoney } from "@/lib/money"
import { duration, ease, spring } from "@/lib/motion"
import { useCart } from "@/lib/stores/cart"
import { cn } from "@/lib/utils"
import type { BrandGroup, PricedLine } from "@/lib/cart"
import type { CurrencyCode } from "@/config/markets"
import { BrandMark } from "./brand-mark"

/** A line folds away: its height closes as it fades, so the lines below rise into its place. */
const lineExit = { opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0, transition: { duration: duration.dropdown, ease: ease.in } }

const stepButton =
  "inline-flex size-10 items-center justify-center rounded-md text-ink-2 outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-violet disabled:opacity-30 sm:size-8"

/**
 * Cart lines grouped by brand — shared by the cart drawer and the cart page (/bag).
 *
 * Removing a line (its ×, or − at quantity 1) unmounts it. Focus moves to the remove button
 * of the line that takes its place (or the one before, for the last line), so keyboard users
 * keep their place; once the bag is empty, to `focusWhenEmpty` if given (the page's empty state).
 * A line or brand section that is leaving (its exit still running) is marked `data-leaving` and
 * made inert, so it can't be clicked, focused or chosen as the next place for focus.
 */
export function BagGroups({
  groups,
  currency,
  compact = false,
  onNavigate,
  focusWhenEmpty,
}: {
  groups: BrandGroup[]
  currency: CurrencyCode
  compact?: boolean
  onNavigate?: () => void
  /** Where focus goes when the last line is removed. */
  focusWhenEmpty?: React.RefObject<HTMLElement | null>
}) {
  const setQuantity = useCart((s) => s.setQuantity)
  const remove = useCart((s) => s.remove)

  // The capture runs before the line's own click handler and the bubble after it, so the cart
  // can be compared across the click. Lines already leaving are skipped when choosing where
  // focus goes next.
  const removal = useRef<{ count: number; next: HTMLElement | null } | null>(null)
  function onClickCapture(e: React.MouseEvent<HTMLDivElement>) {
    removal.current = null
    const li = (e.target as HTMLElement).closest("button")?.closest<HTMLLIElement>("li[data-line]")
    if (!li) return
    const rows = [...e.currentTarget.querySelectorAll<HTMLLIElement>("li[data-line]")].filter((r) => !r.closest("[data-leaving]"))
    const i = rows.indexOf(li)
    const next = (rows[i + 1] ?? rows[i - 1])?.querySelector<HTMLElement>('button[aria-label^="Remove "]') ?? null
    removal.current = { count: useCart.getState().lines.length, next }
  }
  function onClick() {
    const r = removal.current
    removal.current = null
    if (!r || useCart.getState().lines.length >= r.count) return
    window.requestAnimationFrame(() => (r.next?.isConnected ? r.next : focusWhenEmpty?.current)?.focus())
  }

  return (
    <LayoutGroup>
      <div className="flex flex-col gap-4" onClickCapture={onClickCapture} onClick={onClick}>
        <AnimatePresence initial={false}>
          {groups.map((g) => (
            <BagSection key={g.brand.id} group={g} currency={currency} compact={compact} onNavigate={onNavigate} onRemove={remove} onQuantity={setQuantity} />
          ))}
        </AnimatePresence>
      </div>
    </LayoutGroup>
  )
}

type LineActions = {
  onNavigate?: () => void
  onRemove: (variantId: string) => void
  onQuantity: (variantId: string, quantity: number) => void
}

/** One brand's lines. While its exit runs (its last line was removed) it is marked as leaving and made inert. */
function BagSection({
  group: g,
  currency,
  compact,
  onNavigate,
  onRemove,
  onQuantity,
}: { group: BrandGroup; currency: CurrencyCode; compact: boolean } & LineActions) {
  const present = useIsPresent()
  return (
    <motion.section
      data-leaving={present ? undefined : ""}
      inert={!present}
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: duration.dropdown, ease: ease.in } }}
      transition={spring.layout}
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
        {/* The day count and the shipping footer come from this brand's quote alone, so they
            appear once it has loaded and never show a number Yard didn't quote (§6.5). */}
        {g.shippingKnown ? <p className="shrink-0 text-xs text-ink-2 tabular">{g.days[0]}–{g.days[1]} business days</p> : null}
      </header>
      <ul className="divide-y divide-white/6">
        <AnimatePresence initial={false}>
          {g.lines.map((l) => (
            <BagLine key={l.variant.id} line={l} currency={currency} compact={compact} onNavigate={onNavigate} onRemove={onRemove} onQuantity={onQuantity} />
          ))}
        </AnimatePresence>
      </ul>
      {g.shippingKnown && g.option ? (
        <footer className="flex items-center justify-between gap-3 border-t border-white/6 px-4 py-2.5 text-xs">
          <span className="flex min-w-0 items-center gap-1.5 text-ink-2">
            <Truck className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">
              {g.freeShipping ? `${g.option.label} ships free` : g.toFreeShipping > 0 ? `${formatMoney(g.toFreeShipping, currency)} more for free shipping` : g.option.service === "pickup" ? g.option.label : `${g.option.label} shipping`}
            </span>
          </span>
          <span className="shrink-0 tabular text-ink">{g.freeShipping ? "Free" : formatMoney(g.shipping, currency)}</span>
        </footer>
      ) : null}
    </motion.section>
  )
}

/** One bag line. While its exit runs it is marked as leaving and made inert (see BagGroups). */
function BagLine({
  line: l,
  currency,
  compact,
  onNavigate,
  onRemove,
  onQuantity,
}: { line: PricedLine; currency: CurrencyCode; compact: boolean } & LineActions) {
  const present = useIsPresent()
  return (
    <motion.li
      data-line={l.variant.id}
      data-leaving={present ? undefined : ""}
      inert={!present}
      layout="position"
      exit={lineExit}
      transition={spring.layout}
      className="flex gap-3 overflow-hidden px-4 py-3"
    >
      <Link href={`/products/${l.product.slug}`} onClick={onNavigate} className={cn("relative shrink-0 overflow-hidden rounded-md bg-surface", compact ? "h-20 w-16" : "h-28 w-22")}>
        <Image src={l.product.images[0].src} alt={l.product.images[0].alt} fill sizes="96px" className="object-cover" />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link href={`/products/${l.product.slug}`} onClick={onNavigate} className="block truncate text-sm text-ink">{l.product.name}</Link>
            <p className="truncate text-xs text-ink-2">{variantLabel(l.variant.options)}</p>
          </div>
          <button
            type="button"
            onClick={() => onRemove(l.variant.id)}
            aria-label={`Remove ${l.product.name}`}
            className="relative -mt-1 -mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-ink-3 outline-none transition after:absolute after:-inset-1.5 hover:bg-elevated hover:text-ink focus-visible:ring-2 focus-visible:ring-violet"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <div className="inline-flex h-10 items-center rounded-md border border-line sm:h-8" role="group" aria-label={`Quantity of ${l.product.name}`}>
            <button type="button" onClick={() => onQuantity(l.variant.id, l.line.quantity - 1)} aria-label="Decrease quantity" className={stepButton}>
              <Minus className="size-3.5" />
            </button>
            <span className="w-6 text-center text-sm tabular" aria-live="polite">{l.line.quantity}</span>
            <button type="button" onClick={() => onQuantity(l.variant.id, l.line.quantity + 1)} disabled={l.line.quantity >= l.maxQty} aria-label="Increase quantity" className={stepButton}>
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
  )
}
