"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { CheckIcon, PlusIcon, ShoppingBagOpenIcon } from "@phosphor-icons/react"
import { motion } from "motion/react"
import { ChipRadioGroup } from "@/components/market/catalog/chip"
import { useDropClock } from "@/components/market/editorial/use-drop-phase"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useAsyncAction } from "@/hooks/use-async-action"
import { availableStock } from "@/lib/data/products"
import { duration, ease, spring } from "@/lib/motion"
import { MAX_QTY_PER_LINE, useCart } from "@/lib/stores/cart"
import { cn } from "@/lib/utils"
import type { Drop, DropAccess, Product } from "@/lib/data/types"
import { dropOf, useDropAddBlock, type AddBlocked } from "./use-drop-add-block"

export type { AddBlocked }

/**
 * Kept for callers: confirmation of an add is now the comic bubble that pops out of the
 * header's bag icon (BagPop), driven by the cart's own `pulse`, so no toast is shown.
 */
export function addedToast(...args: [product: Product, label: string]): void {
  void args
}

type Props = {
  product: Product
  className?: string
  /**
   * Adding is closed for now; the button stays focusable and a tap explains why. Leave it unset
   * and a piece released in a drop follows the drop's rules (useDropAddBlock). Pass `false` when
   * the caller has already applied those rules and adding is open (the drop page's grid).
   */
  addBlocked?: AddBlocked | false
}

/** A closed quick add, with the few words the capsule shows for it ("Opens 8 Nov", "Entries closed"). */
type Closed = AddBlocked & { label: string }

const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" })
const hourMinute = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })

/** The capsule's words for why adding is closed, from useDropAddBlock's reason. */
function closedLabel(reason: string | undefined, release: number | null, now: number | null, access?: DropAccess) {
  switch (reason) {
    case "not released yet": {
      // A draw never opens the bag to everyone: entries close at release and only drawn winners
      // can buy, so before release the way in is the draw, never a time to come back and add.
      if (access === "draw") return "Enter the draw"
      // The clock is only read once mounted; until then the plain reason stands in.
      if (release === null || now === null) return "Not released yet"
      const at = new Date(release)
      return at.toDateString() === new Date(now).toDateString() ? `Opens ${hourMinute.format(at)}` : `Opens ${dayMonth.format(at)}`
    }
    case "sold out":
      return "Sold out"
    case "entries closed":
      return "Entries closed"
    case "drop limit reached":
      return "Limit reached"
    default:
      return reason ? reason[0].toUpperCase() + reason.slice(1) : "Not available"
  }
}

/**
 * The reason for the accessible name, with the capsule's own words when they add to it
 * ("not released yet, opens 8 Nov"), so what a sighted shopper reads is part of the name.
 */
function closedWords(closed: Closed) {
  const reason = closed.reason ?? "not available yet"
  const shown = closed.label[0].toLowerCase() + closed.label.slice(1)
  return reason.includes(shown) ? reason : `${reason}, ${shown}`
}

/** Quick add: one tap when there is one variant; otherwise a small size/colour picker. */
export function QuickAdd({ product, className, addBlocked }: Props) {
  const drop = dropOf(product)
  if (drop && addBlocked === undefined) return <DropQuickAdd product={product} className={className} drop={drop} />
  if (drop && addBlocked !== undefined) return <AppliedDropQuickAdd product={product} className={className} drop={drop} addBlocked={addBlocked} />
  return <QuickAddButton product={product} className={className} closed={addBlocked ? { ...addBlocked, label: closedLabel(addBlocked.reason, null, null) } : undefined} />
}

/** A piece released in a drop: the drop's rules decide whether this tap adds or explains. */
function DropQuickAdd({ drop, ...props }: Omit<Props, "addBlocked"> & { drop: Drop }) {
  const { addBlocked, release, now } = useDropAddBlock(drop)
  return <QuickAddButton {...props} closed={addBlocked ? { ...addBlocked, label: closedLabel(addBlocked.reason, release, now, drop.access) } : undefined} />
}

/** The caller applied the drop's rules (the drop page); the clock here only words the capsule ("Opens 8 Nov"). */
function AppliedDropQuickAdd({ drop, addBlocked, ...props }: Omit<Props, "addBlocked"> & { drop: Drop; addBlocked: AddBlocked | false }) {
  const { release, now } = useDropClock(drop, 60_000)
  return <QuickAddButton {...props} closed={addBlocked ? { ...addBlocked, label: closedLabel(addBlocked.reason, release, now, drop.access) } : undefined} />
}

/*
 * The capsule. At rest it is the 40px "+" circle; on hover (a mouse), keyboard focus, an open
 * picker or just after a tap it widens to the left into a capsule with the bag icon and its
 * words ("Add to cart", "Choose size", "Added", or why adding is closed). The circle's 40px slot
 * never changes size, so the card never reflows: the button is absolutely placed in it and
 * grows over the photograph. The button's box takes its new width at once (it has no paint of
 * its own); the visible pill is a layer inside it that Motion carries to that width as a
 * transform (a layout animation), with the words and icon held still and uncovered as it
 * grows. Reduced motion makes the change instant (MotionConfig, globals.css).
 */
const morph = { type: "tween", duration: duration.hover, ease: ease.out } as const

const whenOpen = {
  show: "group-data-expanded/qa:opacity-100",
  plusOut: "group-data-expanded/qa:rotate-90 group-data-expanded/qa:scale-75 group-data-expanded/qa:opacity-0",
  bagIn: "group-data-expanded/qa:scale-100 group-data-expanded/qa:opacity-100",
}

/** Left padding, the icon's 38px square and the 1px glass border on each side. */
const CHROME_PX = 14 + 38 + 2

/** A picker closed by Radix's trigger semantics, for a capsule that no longer opens one. */
const noPopup = { "aria-haspopup": undefined, "aria-expanded": undefined, "aria-controls": undefined }

function QuickAddButton({ product, className, closed: blocked }: { product: Product; className?: string; closed?: Closed }) {
  const add = useCart((s) => s.add)
  const [open, setOpen] = useState(false)
  /** Set briefly after a tap on a closed capsule, so a touch shows the reason as it explains. */
  const [explainAt, setExplainAt] = useState(0)
  const [result, setResult] = useState<"added" | "in-cart">("added")
  /** A mouse over the capsule (touch never hovers: a tap expands it as it acts). */
  const [hovered, setHovered] = useState(false)
  /** Keyboard focus (focus-visible), so a click's focus doesn't hold the capsule open. */
  const [focusRing, setFocusRing] = useState(false)
  /** The words the capsule showed when the add was made: its width holds through the flash. */
  const [heldLabel, setHeldLabel] = useState("")
  const [widths, setWidths] = useState<Record<string, number>>({})
  const colourOpt = product.options.find((o) => o.name === "Colour")
  const sizeOpt = product.options.find((o) => o.name === "Size")
  const colours = colourOpt && colourOpt.name === "Colour" ? colourOpt.values : []
  const [colour, setColour] = useState<string | undefined>(colours[0]?.name)
  const soldOut = !product.variants.some((v) => availableStock(v) > 0)
  const single = product.variants.length === 1
  const noun = sizeOpt ? "size" : "colour"

  // Sold out reads as such on every card, drop or not; a tap only shows the words.
  const closed: Closed | undefined = soldOut ? { reason: "sold out", label: "Sold out", describedBy: blocked?.describedBy, onAttempt: () => {} } : blocked
  const pickable = !single && !closed
  // Adding closed while the picker was up (the drop's clock moved on): put it away, so it
  // can't open again by itself if adding reopens later.
  if (open && !pickable) setOpen(false)

  const sizeVariants = useMemo(() => product.variants.filter((v) => !colour || v.options.Colour === colour), [product.variants, colour])

  // A local add completes at once; the check shows for a moment and repeat presses meanwhile
  // are ignored, as on the product page. The "Added to cart" bubble (BagPop) confirms it.
  const adding = useAsyncAction(
    (variantId: string) => {
      const before = useCart.getState().lines.find((l) => l.variantId === variantId)?.quantity ?? 0
      add(product.id, variantId, 1)
      return before >= MAX_QTY_PER_LINE ? ("in-cart" as const) : ("added" as const)
    },
    { successFlashMs: 1500, onSuccess: setResult },
  )

  useEffect(() => {
    if (!explainAt) return
    const t = window.setTimeout(() => setExplainAt(0), 1800)
    return () => window.clearTimeout(t)
  }, [explainAt])

  const added = adding.succeeded
  // From the tap until the flash ends the capsule belongs to the add: it keeps the add's look
  // (an add that just reached a drop's limit still confirms in acid) and ignores repeat presses.
  const busy = adding.pending || added
  const readyLabel = closed ? closed.label : single ? "Add to cart" : `Choose ${noun}`

  function commit(variantId: string) {
    setOpen(false)
    setHeldLabel(readyLabel)
    void adding.run(variantId)
  }

  const label = added ? (result === "in-cart" ? "In your cart" : "Added") : adding.pending ? heldLabel : readyLabel
  // Closed looks (grey glass, not-allowed) only once any add on it has finished confirming.
  const closedLook = closed !== undefined && !busy
  const ariaLabel = soldOut
    ? `${product.name} is sold out`
    : closed
      ? `Add ${product.name} to cart, ${closedWords(closed)}`
      : single
        ? `Add ${product.name} to cart`
        : `Choose a ${noun} for ${product.name}`
  const pickerOpen = open && pickable
  const expanded = hovered || focusRing || pickerOpen || busy || explainAt > 0

  // The capsule's open width comes from its words, measured once mounted (and again if the
  // font swaps in); before that a close estimate stands in. While an add confirms, the width
  // holds at the wider of "Added" and the words it replaced, so success never shrinks it.
  const labelRef = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const el = labelRef.current
    if (!el) return
    const measure = () => {
      const w = el.offsetWidth
      setWidths((m) => (m[label] === w ? m : { ...m, [label]: w }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [label])
  const widthOf = (text: string) => widths[text] ?? Math.round(text.length * 7.4)
  const labelArea = busy && heldLabel ? Math.max(widthOf(label), widthOf(heldLabel)) : widthOf(label)
  const width = expanded ? labelArea + CHROME_PX : 40

  const button = (
    <button
      type="button"
      onClick={(e) => {
        // preventDefault also keeps Radix's trigger from toggling the picker a second time.
        e.preventDefault()
        e.stopPropagation()
        if (busy) return
        if (closed) {
          setExplainAt(Date.now())
          return closed.onAttempt()
        }
        if (single) commit(product.variants[0].id)
        else setOpen((o) => !o)
      }}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") setHovered(true)
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") setHovered(false)
      }}
      onFocus={(e) => setFocusRing(e.currentTarget.matches(":focus-visible"))}
      onBlur={() => setFocusRing(false)}
      aria-label={ariaLabel}
      aria-disabled={closedLook ? true : undefined}
      aria-describedby={closed?.describedBy}
      {...(single || pickable ? {} : noPopup)}
      data-expanded={expanded ? "" : undefined}
      data-phase={busy ? "added" : closed ? "closed" : pickerOpen ? "picking" : "ready"}
      style={{ width }}
      className={cn(
        "group/qa absolute right-0 bottom-0 h-10 touch-manipulation rounded-full outline-hidden",
        "transition-[color,scale] duration-150 ease-out-quint active:scale-[0.96]",
        closedLook ? "cursor-not-allowed text-ink-2" : expanded ? "text-obsidian" : "text-ink",
        className,
      )}
    >
      {/* The pill. Its focus ring travels with it; the words and icon inside stay put while it
          grows and are uncovered by it (layout children are held against its scale). */}
      <motion.span
        layout
        transition={morph}
        aria-hidden
        style={{ borderRadius: 20 }}
        className={cn(
          "glass pointer-events-none absolute inset-0 overflow-hidden outline-violet transition-[background-color] duration-200 ease-out-quint",
          "group-focus-visible/qa:outline-2 group-focus-visible/qa:outline-offset-2",
          expanded && (closedLook ? "bg-[var(--glass-bg-strong)]" : "bg-acid"),
        )}
      >
        {/* The words, against the icon (centred in the held width while "Added" shows). */}
        <motion.span layout="position" transition={morph} className="absolute inset-y-0 right-[38px] flex items-center justify-center" style={{ width: labelArea }}>
          <span
            key={label}
            ref={labelRef}
            className={cn("block whitespace-nowrap text-[13px] leading-none font-medium opacity-0 transition-opacity duration-150 ease-out-quint animate-in fade-in-0", whenOpen.show)}
          >
            {label}
          </span>
        </motion.span>
        <motion.span layout="position" transition={morph} className="absolute inset-y-0 right-0 grid w-[38px] place-items-center">
          {added ? (
            <motion.span key={result} className="col-start-1 row-start-1" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring.snappy}>
              {/* Nothing went in when the cart already held the most: the cart, not a check. */}
              {result === "in-cart" ? <ShoppingBagOpenIcon weight="fill" className="size-[18px]" /> : <CheckIcon weight="bold" className="size-[18px]" />}
            </motion.span>
          ) : (
            <>
              <PlusIcon className={cn("col-start-1 row-start-1 size-[18px] transition-[opacity,transform] duration-200 ease-out-quint", closedLook && "opacity-60", whenOpen.plusOut)} />
              <ShoppingBagOpenIcon className={cn("col-start-1 row-start-1 size-[18px] scale-75 opacity-0 transition-[opacity,transform] duration-200 ease-out-quint", whenOpen.bagIn)} />
            </>
          )}
        </motion.span>
      </motion.span>
    </button>
  )

  // One variant never opens a picker. Otherwise the button stays inside the Popover whether or
  // not adding is open, so it is never remounted (and never drops focus) when a picker add
  // reaches a drop's limit or the drop closes.
  if (single) return button

  return (
    <Popover open={pickerOpen} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{button}</PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        sideOffset={10}
        aria-label={`Choose a ${noun} for ${product.name}`}
        className="w-64 rounded-xl p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-xs text-ink-2">Choose a {noun}</p>
        {colours.length > 1 ? (
          // One tab stop; the arrow keys, Home and End move the choice (the ARIA radio pattern).
          <ChipRadioGroup label="Colour" className="mt-2 flex gap-3">
            {colours.map((c) => (
              <button
                key={c.name}
                type="button"
                role="radio"
                aria-checked={colour === c.name}
                tabIndex={colour === c.name ? 0 : -1}
                aria-label={c.name}
                onClick={() => setColour(c.name)}
                // 28px to the eye, 40px to a finger (the extension fills the gap, never past it).
                className={cn("relative size-7 rounded-full border-2 transition after:absolute after:-inset-1.5 after:rounded-full", colour === c.name ? "border-violet" : "border-transparent")}
              >
                <span className="block size-full rounded-full border border-white/15" style={{ background: c.hex }} />
              </button>
            ))}
          </ChipRadioGroup>
        ) : null}
        {sizeOpt ? (
          <div className="mt-3 grid grid-cols-4 gap-1.5">
            {sizeVariants.map((v) => {
              const out = availableStock(v) === 0
              return (
                <button
                  key={v.id}
                  type="button"
                  disabled={out}
                  aria-label={out ? `Size ${v.options.Size}, sold out` : `Add size ${v.options.Size} to cart`}
                  onClick={() => commit(v.id)}
                  className={cn(
                    "h-10 rounded-sm border border-line text-xs tabular transition-colors hover:border-violet hover:bg-purple/15 sm:h-9",
                    out && "cursor-not-allowed text-ink-3 line-through decoration-ink-3 hover:border-line hover:bg-transparent",
                  )}
                >
                  {v.options.Size}
                </button>
              )
            })}
          </div>
        ) : (
          <button
            type="button"
            disabled={!sizeVariants[0] || availableStock(sizeVariants[0]) === 0}
            onClick={() => commit(sizeVariants[0].id)}
            className="mt-3 h-10 w-full rounded-sm bg-acid text-sm font-medium text-obsidian transition-[background-color,transform] duration-150 hover:bg-acid/85 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 sm:h-9"
          >
            {sizeVariants[0] && availableStock(sizeVariants[0]) === 0 ? `${colour} is sold out` : `Add ${colour} to cart`}
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}
