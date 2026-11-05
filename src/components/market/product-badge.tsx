import { cn } from "@/lib/utils"
import type { Product } from "@/lib/data/types"

const labels: Record<string, string> = {
  sale: "Sale",
  new: "New",
  limited: "Limited",
  exclusive: "Exclusive",
  restock: "Restocked",
  "last-pieces": "Last pieces",
}

/** One badge per card, in priority order. Acid = sale (price signal); purple = scarcity. */
export function primaryBadge(p: Pick<Product, "badges" | "compareAt">) {
  if (p.compareAt) return "sale"
  for (const b of ["limited", "exclusive", "last-pieces", "new", "restock"] as const) {
    if (p.badges.includes(b)) return b
  }
  return null
}

export function ProductBadge({ kind, className }: { kind: string; className?: string }) {
  const tone =
    kind === "sale"
      ? "bg-acid text-obsidian"
      : kind === "limited" || kind === "exclusive"
        ? "bg-purple text-ink"
        : "glass text-ink"
  return <span className={cn("inline-flex h-6 items-center rounded-[5px] px-2 text-[11px] font-medium", tone, className)}>{labels[kind] ?? kind}</span>
}
