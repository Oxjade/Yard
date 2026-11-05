import { cn } from "@/lib/utils"
import type { Brand } from "@/lib/data/types"

const sizes = {
  xs: "size-6 text-[9px] rounded-[4px]",
  sm: "size-8 text-[11px] rounded-[5px]",
  md: "size-11 text-sm rounded-md",
  lg: "size-16 text-xl rounded-lg",
  xl: "size-24 text-3xl rounded-xl",
}

/** Typographic logo mark — brands upload real logos in Brand Studio; this is the fallback. */
export function BrandMark({ brand, size = "md", className }: { brand: Pick<Brand, "mark" | "name">; size?: keyof typeof sizes; className?: string }) {
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
