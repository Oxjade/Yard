"use client"

import Image from "next/image"
import { ImageBrokenIcon as ImageOff, InfoIcon as Info } from "@phosphor-icons/react"
import { StatusBadge } from "@/components/dashboard/status-badge"
import type { ImageAsset } from "@/lib/data/types"
import { cn } from "@/lib/utils"
import { productLevel, variantLevel } from "./utils"

/**
 * Square product thumbnail used in every catalogue list. Pass loading="eager" when the same
 * photo is also the page's large above-the-fold image: Next tracks loading per photo URL, so
 * a lazy thumbnail would mark that large image lazy too.
 */
export function Thumb({ image, size = 40, className, loading }: { image?: ImageAsset; size?: number; className?: string; loading?: "eager" | "lazy" }) {
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface", className)} style={{ width: size, height: size }}>
      {image ? <Image src={image.src} alt="" fill sizes={`${size}px`} loading={loading} className="object-cover" /> : <ImageOff className="size-4 text-ink-3" aria-hidden />}
    </span>
  )
}

/** A product's total stock: acid when low, "Out of stock" at zero. */
export function ProductStock({ available }: { available: number }) {
  const level = productLevel(available)
  if (level === "out") return <StatusBadge tone="attention">Out of stock</StatusBadge>
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 whitespace-nowrap">
      <span className={cn("tabular", level === "low" ? "text-acid" : "text-ink")}>{available.toLocaleString("en-US")} in stock</span>
      {level === "low" ? <StatusBadge tone="attention">Low</StatusBadge> : null}
    </span>
  )
}

export function VariantStatus({ available }: { available: number }) {
  const level = variantLevel(available)
  if (level === "out") return <StatusBadge tone="attention">Out of stock</StatusBadge>
  if (level === "low") return <StatusBadge tone="attention">Low</StatusBadge>
  return <StatusBadge tone="success">In stock</StatusBadge>
}

export function Swatch({ hex, className }: { hex?: string; className?: string }) {
  if (!hex) return null
  return <span aria-hidden className={cn("inline-block size-3 shrink-0 rounded-full border border-white/20", className)} style={{ background: hex }} />
}

/**
 * The one quiet, page-level note about where catalogue edits go in this build: Studio keeps
 * products, stock and collections in its own store, and the marketplace reads the sample
 * catalogue until the catalogue backend is connected. Toasts and buttons then just say what
 * happened in Studio.
 */
export function CatalogueNote({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <p className={cn("flex items-start gap-1.5 text-xs text-ink-3", className)}>
      <Info className="mt-px size-3.5 shrink-0" aria-hidden />
      <span>{children ?? "Changes here are saved in Studio. They reach shoppers in the marketplace once the catalogue backend is connected."}</span>
    </p>
  )
}
