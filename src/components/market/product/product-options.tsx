"use client"

import { useId, useState } from "react"
import { MinusIcon as Minus, PlusIcon as Plus } from "@phosphor-icons/react"
import { AnimatePresence, motion } from "motion/react"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"
import { duration, ease, spring } from "@/lib/motion"
import { cn } from "@/lib/utils"
import type { ColourValue } from "@/lib/data/types"
import { LOW_STOCK, type ProductSelection } from "./use-product-selection"

const pillSpring = spring.indicator

/** Colour swatches: a radio group. A colour with nothing left stays selectable so its sizes can be seen. */
export function ColourSwatches({
  colours,
  value,
  onChange,
  hasStock,
  layoutKey,
}: {
  colours: ColourValue[]
  value?: string
  onChange: (name: string) => void
  hasStock: (name: string) => boolean
  layoutKey: string
}) {
  const labelId = useId()
  return (
    <div>
      <p id={labelId} className="text-sm text-ink-2">
        Colour <span className="ml-1 text-ink">{value}</span>
      </p>
      <RadioGroupPrimitive.Root value={value} onValueChange={onChange} aria-labelledby={labelId} orientation="horizontal" className="mt-3 flex flex-wrap gap-2">
        {colours.map((c) => {
          const checked = c.name === value
          const out = !hasStock(c.name)
          return (
            <RadioGroupPrimitive.Item
              key={c.name}
              value={c.name}
              aria-label={out ? `${c.name}, sold out` : c.name}
              title={c.name}
              className="relative inline-flex size-10 items-center justify-center rounded-full outline-offset-2 transition-transform duration-100 active:scale-95"
            >
              {checked ? <motion.span layoutId={`${layoutKey}-colour`} transition={pillSpring} className="absolute inset-0 rounded-full border-2 border-violet" /> : null}
              <span className="relative block size-7 overflow-hidden rounded-full border border-white/15" style={{ background: c.hex }}>
                {out ? <span className="absolute top-1/2 left-1/2 h-px w-[140%] -translate-x-1/2 -translate-y-1/2 -rotate-45 bg-ink/80" aria-hidden /> : null}
              </span>
            </RadioGroupPrimitive.Item>
          )
        })}
      </RadioGroupPrimitive.Root>
    </div>
  )
}

/** Size grid: squared boxes in a radio group. Sold-out sizes are struck through and cannot be chosen. */
export function SizeGrid({
  sizes,
  stockBySize,
  value,
  onChange,
  disabled = false,
  layoutKey,
  labelledBy,
  describedBy,
  invalid = false,
}: {
  sizes: string[]
  stockBySize: Map<string, number>
  value?: string
  onChange: (size: string) => void
  disabled?: boolean
  layoutKey: string
  labelledBy: string
  /** The hint shown when Add to bag was pressed without a size. */
  describedBy?: string
  invalid?: boolean
}) {
  return (
    <RadioGroupPrimitive.Root
      value={value ?? ""}
      onValueChange={onChange}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      disabled={disabled}
      className="grid grid-cols-[repeat(auto-fill,minmax(3.5rem,1fr))] gap-2"
    >
      {sizes.map((s) => {
        const out = (stockBySize.get(s) ?? 0) === 0
        const checked = value === s
        return (
          <RadioGroupPrimitive.Item
            key={s}
            value={s}
            disabled={disabled}
            aria-label={out ? `${s}, sold out` : s}
            className={cn(
              "relative isolate flex aspect-square max-h-16 min-h-11 items-center justify-center rounded-md border text-sm tabular transition-[border-color,color,transform,scale] duration-150 active:scale-[0.96] active:duration-100",
              checked ? "border-purple text-ink" : invalid ? "border-danger/50 text-ink hover:border-danger/80" : "border-line text-ink hover:border-ink-2/60",
              out && "border-line-soft text-ink-3 line-through decoration-ink-3 hover:border-ink-2/60",
              disabled && !out && "cursor-not-allowed text-ink-2 hover:border-line",
            )}
          >
            {checked ? <motion.span layoutId={`${layoutKey}-size`} transition={pillSpring} className="absolute inset-0 -z-10 rounded-[5px] bg-purple" /> : null}
            {s}
          </RadioGroupPrimitive.Item>
        )
      })}
    </RadioGroupPrimitive.Root>
  )
}

/**
 * One line of availability for the current choice: in stock, only N left (acid) or sold out.
 * Before a drop's release nothing can be chosen yet, so it says when sizes open instead of
 * counting them (which would read as buyable now), matching the drop module. A released draw
 * (`closed`) sells only to drawn winners, so it says that instead of counting stock.
 */
export function StockLine({ selection, locked = false, closed = false, className }: { selection: ProductSelection; locked?: boolean; closed?: boolean; className?: string }) {
  const { variant, stock, sizes, needsSize, colourStock, sizesInStock, colour } = selection
  let text: string
  let tone: "ok" | "low" | "out" | "muted"
  if (locked) {
    ;[text, tone] = [sizes.length ? "Sizes open at release" : "Opens at release", "muted"]
  } else if (closed) {
    ;[text, tone] = ["Drawn winners only", "muted"]
  } else if (variant && stock !== null) {
    if (stock === 0) [text, tone] = ["Sold out", "out"]
    else if (stock <= LOW_STOCK) [text, tone] = [`Only ${stock} left`, "low"]
    else [text, tone] = ["In stock", "ok"]
  } else if (needsSize && colourStock === 0) {
    ;[text, tone] = [colour ? `Sold out in ${colour.toLowerCase()}` : "Sold out", "out"]
  } else {
    ;[text, tone] = [`${sizesInStock} of ${sizes.length} sizes in stock`, "muted"]
  }

  return (
    <p className={cn("flex h-5 items-center gap-2 text-sm", className)} aria-live="polite">
      <span
        aria-hidden
        className={cn("size-1.5 shrink-0 rounded-full", tone === "ok" ? "bg-violet" : tone === "low" ? "bg-acid" : tone === "out" ? "bg-ink-3" : "bg-ink-3/60")}
      />
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={text}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: duration.hover, ease: ease.out }}
          className={cn(tone === "ok" ? "text-ink" : tone === "low" ? "text-acid" : tone === "out" ? "text-ink-3" : "text-ink-2")}
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </p>
  )
}

/** Quantity stepper, bounded by what can still be bought. */
const roll = {
  enter: (dir: number) => ({ y: 14 * dir, opacity: 0 }),
  center: { y: 0, opacity: 1 },
  exit: (dir: number) => ({ y: -14 * dir, opacity: 0 }),
}

export function QuantityStepper({ value, max, onChange, disabled = false }: { value: number; max: number; onChange: (n: number) => void; disabled?: boolean }) {
  const top = Math.max(1, max)
  // Up rolls the number up, down rolls it down.
  const [last, setLast] = useState(value)
  const [dir, setDir] = useState(1)
  if (value !== last) {
    setDir(value > last ? 1 : -1)
    setLast(value)
  }
  return (
    <div className={cn("inline-flex h-12 items-center rounded-md border border-line", disabled && "opacity-45")} role="group" aria-label="Quantity">
      <button
        type="button"
        onClick={() => onChange(Math.max(1, value - 1))}
        disabled={disabled || value <= 1}
        aria-label="Decrease quantity"
        className="inline-flex size-12 items-center justify-center rounded-l-md text-ink-2 transition-[background-color,color,transform,scale] duration-150 hover:bg-elevated hover:text-ink active:scale-90 active:duration-100 disabled:pointer-events-none disabled:opacity-35"
      >
        <Minus className="size-4" />
      </button>
      <span className="relative inline-flex h-full w-9 items-center justify-center overflow-hidden text-base tabular">
        {/* The number rolls in the direction it moved; the live text is read once, without the roll. */}
        <span className="sr-only" aria-live="polite" aria-atomic="true">
          Quantity {value}
        </span>
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          <motion.span
            key={value}
            aria-hidden
            custom={dir}
            variants={roll}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: duration.press, ease: ease.out }}
          >
            {value}
          </motion.span>
        </AnimatePresence>
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(top, value + 1))}
        disabled={disabled || value >= top}
        aria-label="Increase quantity"
        className="inline-flex size-12 items-center justify-center rounded-r-md text-ink-2 transition-[background-color,color,transform,scale] duration-150 hover:bg-elevated hover:text-ink active:scale-90 active:duration-100 disabled:pointer-events-none disabled:opacity-35"
      >
        <Plus className="size-4" />
      </button>
    </div>
  )
}
