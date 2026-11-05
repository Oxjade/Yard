"use client"

import { useState } from "react"
import { getDemoAnchor, useNow } from "@/hooks/use-now"
import { dropPhaseAt, initialDropPhase } from "@/lib/drops"
import { availableStock } from "@/lib/data/products"
import type { ColourValue, Drop, DropPhase, Product } from "@/lib/data/types"

/** Below this many units a variant shows "Only N left" (truthful scarcity: real stock only). */
export const LOW_STOCK = 3

/**
 * Colour, size and quantity for one product page, and everything derived from them:
 * the chosen variant, its sellable stock and per-size availability for the chosen colour.
 */
export function useProductSelection(product: Product) {
  const sizeOption = product.options.find((o) => o.name === "Size")
  const colourOption = product.options.find((o) => o.name === "Colour")
  const sizes: string[] = sizeOption?.name === "Size" ? sizeOption.values : []
  const colours: ColourValue[] = colourOption?.name === "Colour" ? colourOption.values : []

  const colourHasStock = (name: string) => product.variants.some((v) => v.options.Colour === name && availableStock(v) > 0)
  const [colour, setColourState] = useState<string | undefined>(() => colours.find((c) => colourHasStock(c.name))?.name ?? colours[0]?.name)
  const [size, setSize] = useState<string | undefined>(undefined)
  const [quantity, setQuantity] = useState(1)

  const forColour = product.variants.filter((v) => !colours.length || v.options.Colour === colour)
  const stockBySize = new Map(sizes.map((s) => {
    const v = forColour.find((x) => x.options.Size === s)
    return [s, v ? availableStock(v) : 0] as const
  }))
  const variant = sizes.length ? (size ? forColour.find((v) => v.options.Size === size) : undefined) : forColour[0]
  const stock = variant ? availableStock(variant) : null
  const colourStock = forColour.reduce((n, v) => n + availableStock(v), 0)
  const sizesInStock = sizes.filter((s) => (stockBySize.get(s) ?? 0) > 0).length

  /** Changing colour keeps the size only if that size is still available in the new colour. */
  function setColour(next: string) {
    setColourState(next)
    if (size) {
      const v = product.variants.find((x) => x.options.Colour === next && x.options.Size === size)
      if (!v || availableStock(v) === 0) setSize(undefined)
    }
  }

  return {
    sizes,
    colours,
    colour,
    setColour,
    colourHasStock,
    size,
    setSize,
    quantity,
    setQuantity,
    variant,
    stock,
    stockBySize,
    colourStock,
    sizesInStock,
    needsSize: sizes.length > 0 && !size,
  }
}

export type ProductSelection = ReturnType<typeof useProductSelection>

/**
 * The drop's phase on the demo clock. Before mount it falls back to the phase at load
 * (the same value the server used), so the first client render matches the HTML.
 */
export function useDropPhase(drop: Drop | null): DropPhase | null {
  const now = useNow(5000)
  if (!drop) return null
  return now === null ? initialDropPhase(drop) : dropPhaseAt(drop, now, getDemoAnchor())
}
