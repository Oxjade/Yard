import Link from "next/link"
import { StorefrontIcon } from "@phosphor-icons/react/ssr"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * The deliberate "no brands yet" state production shows while the first brands are setting up:
 * never a shell with "0 studios", never sample brands. One path for shoppers (drops) and one for
 * brands (Sell on Yard). `compact` sits it among other sections (Following, You).
 */
export function BrandsJoining({ compact = false, className, title = "Brands are joining Yard — follow along" }: { compact?: boolean; className?: string; title?: string }) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col items-center gap-4 rounded-lg border border-line-soft bg-card text-center",
        compact ? "px-5 py-10" : "px-6 py-14 md:py-20",
        className,
      )}
    >
      <span className="inline-flex size-14 shrink-0 items-center justify-center rounded-full border border-line text-ink-2 [&_svg]:size-6">
        <StorefrontIcon aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-base break-words text-ink">{title}</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-pretty break-words text-ink-2">
          Independent studios are setting up their storefronts now. Their pieces, drops and stories appear here the day they open.
        </p>
      </div>
      <div className="flex w-full flex-col items-stretch justify-center gap-2 sm:w-auto sm:flex-row sm:items-center">
        <Button asChild variant="primary">
          <Link href="/drops">See upcoming drops</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/sell">Sell on Yard</Link>
        </Button>
      </div>
    </div>
  )
}
