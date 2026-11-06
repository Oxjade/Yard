import { CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react/ssr"
import { cn } from "@/lib/utils"

/** Where the chip sits: on a dark surface, or on a purple or acid filled card. */
export type ChipOn = "dark" | "brand" | "acid"

/**
 * Change against the previous period: ▲ violet on purple for up, ▼ danger for down,
 * "No change" when flat. Renders nothing when there is no previous period to compare with.
 */
export function DeltaChip({
  value,
  size = "md",
  on = "dark",
  context = "the previous period",
  className,
}: {
  /** Change as a ratio (0.12 = 12%). */
  value: number | null | undefined
  size?: "sm" | "md"
  on?: ChipOn
  /** What the change is measured against, for screen readers. */
  context?: string
  className?: string
}) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  const flat = Math.abs(value) < 0.0005
  const up = value > 0
  const pct = Math.abs(value * 100)
  const text = `${pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)}%`
  const tone =
    on === "acid"
      ? "bg-obsidian/10 text-obsidian"
      : on === "brand"
        ? "bg-white/15 text-ink"
        : flat
          ? "bg-white/[0.06] text-ink-2"
          : up
            ? "bg-purple/15 text-violet"
            : "bg-danger/12 text-danger"
  const Icon = up ? CaretUpIcon : CaretDownIcon
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-full font-medium whitespace-nowrap tabular",
        size === "sm" ? "h-5 px-1.5 text-[10.5px]" : "h-6 px-2 text-[11.5px]",
        tone,
        className,
      )}
    >
      {flat ? (
        "No change"
      ) : (
        <>
          <Icon weight="fill" aria-hidden className={size === "sm" ? "size-2.5" : "size-3"} />
          <span aria-hidden>{text}</span>
          <span className="sr-only">{`${up ? "Up" : "Down"} ${text} on ${context}`}</span>
        </>
      )}
    </span>
  )
}
