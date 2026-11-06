import Link from "next/link"
import { ArrowUpRightIcon } from "@phosphor-icons/react/ssr"
import { cn } from "@/lib/utils"
import type { ChipOn } from "./delta-chip"

/**
 * The round arrow that opens a card's detail page. 28px to look at, 40px to hit:
 * the hit area extends past the circle so it is easy to tap on a phone. (The pseudo
 * element is placed against the padding box, inside the 1px border, so it reaches
 * 7px out: 26 + 2 × 7 = 40.)
 */
export function ArrowLink({ href, label, on = "dark", className }: { href: string; label: string; on?: ChipOn; className?: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={cn(
        "group/arrow relative inline-flex size-7 shrink-0 items-center justify-center rounded-full border transition-[background-color,border-color,color] duration-150 ease-out-quint",
        "before:absolute before:-inset-[7px] before:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2",
        on === "acid"
          ? "border-obsidian bg-obsidian text-acid hover:bg-obsidian/85 focus-visible:outline-obsidian"
          : on === "brand"
            ? "border-white/25 bg-white/10 text-ink hover:bg-white hover:text-purple focus-visible:outline-ink"
            : "border-white/12 text-ink-2 hover:border-ink hover:bg-ink hover:text-obsidian focus-visible:outline-violet",
        className,
      )}
    >
      <ArrowUpRightIcon aria-hidden className="size-3.5 transition-transform duration-200 ease-out-quint group-hover/arrow:translate-x-px group-hover/arrow:-translate-y-px" />
    </Link>
  )
}
