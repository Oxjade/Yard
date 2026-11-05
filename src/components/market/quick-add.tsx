"use client"

import { useMemo, useState } from "react"
import { Check, Plus } from "lucide-react"
import { motion } from "motion/react"
import { toast } from "sonner"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { availableStock, variantLabel } from "@/lib/data/products"
import { useCart } from "@/lib/stores/cart"
import { cn } from "@/lib/utils"
import type { Product } from "@/lib/data/types"

export function addedToast(p: Product, label: string) {
  toast("Added to bag", {
    description: label ? `${p.name}, ${label}` : p.name,
    action: { label: "View bag", onClick: () => useCart.getState().open() },
  })
}

/** Quick add: one tap when there is one variant; otherwise a small size/colour picker. */
export function QuickAdd({ product, className }: { product: Product; className?: string }) {
  const add = useCart((s) => s.add)
  const [open, setOpen] = useState(false)
  const [justAdded, setJustAdded] = useState(false)
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

  function commit(variantId: string) {
    const v = product.variants.find((x) => x.id === variantId)!
    add(product.id, variantId, 1)
    addedToast(product, variantLabel(v.options))
    setOpen(false)
    setJustAdded(true)
    window.setTimeout(() => setJustAdded(false), 1400)
  }

  const button = (
    <button
      type="button"
      disabled={!inStock}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (single) commit(product.variants[0].id)
        else setOpen((o) => !o)
      }}
      aria-label={inStock ? `Quick add ${product.name}` : `${product.name} is sold out`}
      className={cn(
        "glass inline-flex size-10 items-center justify-center rounded-full text-ink transition-[background-color,transform] duration-200 hover:bg-acid hover:text-obsidian active:scale-90 disabled:opacity-40 disabled:hover:bg-transparent",
        justAdded && "bg-acid text-obsidian",
        className,
      )}
    >
      <motion.span key={justAdded ? "ok" : "plus"} initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }}>
        {justAdded ? <Check className="size-[18px]" /> : <Plus className="size-[18px]" />}
      </motion.span>
    </button>
  )

  if (single) return button

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
