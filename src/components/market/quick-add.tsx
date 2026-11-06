"use client"

import { useEffect, useMemo, useState } from "react"
import { CheckIcon as Check, PlusIcon as Plus } from "@phosphor-icons/react"
import { motion } from "motion/react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { availableStock } from "@/lib/data/products"
import { useCart } from "@/lib/stores/cart"
import { cn } from "@/lib/utils"
import type { Product } from "@/lib/data/types"
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

/** Quick add: one tap when there is one variant; otherwise a small size/colour picker. */
export function QuickAdd({ product, className, addBlocked }: Props) {
  const drop = addBlocked === undefined ? dropOf(product) : undefined
  if (drop) return <DropQuickAdd product={product} className={className} drop={drop} />
  return <QuickAddButton product={product} className={className} addBlocked={addBlocked || undefined} />
}

/** A piece released in a drop: the drop's rules decide whether this tap adds or explains. */
function DropQuickAdd({ drop, ...props }: Omit<Props, "addBlocked"> & { drop: NonNullable<ReturnType<typeof dropOf>> }) {
  const { addBlocked } = useDropAddBlock(drop)
  return <QuickAddButton {...props} addBlocked={addBlocked} />
}

function QuickAddButton({ product, className, addBlocked }: { product: Product; className?: string; addBlocked?: AddBlocked }) {
  const add = useCart((s) => s.add)
  const [open, setOpen] = useState(false)
  const [justAdded, setJustAdded] = useState(0)
  const colourOpt = product.options.find((o) => o.name === "Colour")
  const sizeOpt = product.options.find((o) => o.name === "Size")
  const colours = colourOpt && colourOpt.name === "Colour" ? colourOpt.values : []
  const [colour, setColour] = useState<string | undefined>(colours[0]?.name)
  const inStock = product.variants.some((v) => availableStock(v) > 0)
  const single = product.variants.length === 1

  const sizeVariants = useMemo(
    () => product.variants.filter((v) => !colour || v.options.Colour === colour),
    [product.variants, colour],
  )

  // The check shows briefly after an add, then the plus returns.
  useEffect(() => {
    if (!justAdded) return
    const t = window.setTimeout(() => setJustAdded(0), 1400)
    return () => window.clearTimeout(t)
  }, [justAdded])

  function commit(variantId: string) {
    add(product.id, variantId, 1)
    setOpen(false)
    setJustAdded(Date.now())
  }

  const added = justAdded > 0
  const label = !inStock ? `${product.name} is sold out` : addBlocked?.reason ? `Quick add ${product.name}, ${addBlocked.reason}` : `Quick add ${product.name}`

  const button = (
    <button
      type="button"
      disabled={!inStock}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (addBlocked) return addBlocked.onAttempt()
        if (single) commit(product.variants[0].id)
        else setOpen((o) => !o)
      }}
      aria-label={label}
      aria-disabled={addBlocked ? true : undefined}
      aria-describedby={addBlocked?.describedBy}
      className={cn(
        "glass inline-flex size-10 items-center justify-center rounded-full text-ink transition-[background-color,transform] duration-200 hover:bg-acid hover:text-obsidian active:scale-90 disabled:opacity-40 disabled:hover:bg-transparent",
        added && "bg-acid text-obsidian",
        addBlocked && "cursor-not-allowed opacity-45 hover:bg-transparent hover:text-ink",
        className,
      )}
    >
      <motion.span key={added ? "ok" : "plus"} initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }}>
        {added ? <Check className="size-[18px]" /> : <Plus className="size-[18px]" />}
      </motion.span>
    </button>
  )

  if (single || addBlocked) return button

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{button}</PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        sideOffset={10}
        className="w-64 rounded-xl p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-xs text-ink-2">Choose {sizeOpt ? "a size" : "a colour"}</p>
        {colours.length > 1 ? (
          <div className="mt-2 flex gap-2" role="radiogroup" aria-label="Colour">
            {colours.map((c) => (
              <button
                key={c.name}
                type="button"
                role="radio"
                aria-checked={colour === c.name}
                aria-label={c.name}
                onClick={() => setColour(c.name)}
                className={cn("size-7 rounded-full border-2 transition", colour === c.name ? "border-violet" : "border-transparent")}
              >
                <span className="block size-full rounded-full border border-white/15" style={{ background: c.hex }} />
              </button>
            ))}
          </div>
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
                  onClick={() => commit(v.id)}
                  className={cn(
                    "h-9 rounded-sm border border-line text-xs tabular transition-colors hover:border-violet hover:bg-purple/15",
                    out && "cursor-not-allowed text-ink-3 line-through decoration-ink-3 hover:border-line hover:bg-transparent",
                  )}
                >
                  {v.options.Size}
                </button>
              )
            })}
          </div>
        ) : (
          <button type="button" onClick={() => commit(sizeVariants[0].id)} className="mt-3 h-9 w-full rounded-sm bg-acid text-sm font-medium text-obsidian">
            Add {colour}
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}
