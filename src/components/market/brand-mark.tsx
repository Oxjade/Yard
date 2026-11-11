import { cn } from "@/lib/utils"
import type { Brand } from "@/lib/data/types"

const sizes = {
  xs: "size-6 text-[9px] rounded-[4px]",
  sm: "size-8 text-[11px] rounded-[5px]",
  md: "size-11 text-sm rounded-md",
  lg: "size-16 text-xl rounded-lg",
  xl: "size-24 text-3xl rounded-xl",
}

/** Typographic logo mark — brands upload real logos in Brand Studio; this is the fallback. A live brand's uploaded logo (logoSrc) shows in its place. */
export function BrandMark({ brand, size = "md", className }: { brand: Pick<Brand, "mark" | "name"> & { logoSrc?: string | null }; size?: keyof typeof sizes; className?: string }) {
  if (brand.logoSrc)
    return (
      <span aria-hidden className={cn("inline-flex shrink-0 overflow-hidden border border-white/12 bg-obsidian", sizes[size], className)}>
        {/* eslint-disable-next-line @next/next/no-img-element -- /api/media serves the brand's own upload */}
        <img src={brand.logoSrc} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
      </span>
    )
  const style =
    brand.mark.style === "condensed" ? "font-display" : brand.mark.style === "expanded" ? "font-wide" : "font-sans font-bold tracking-tight"
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center border border-white/12 bg-obsidian text-ink leading-none select-none",
        sizes[size],
        style,
        className,
      )}
    >
      {brand.mark.text}
    </span>
  )
}
