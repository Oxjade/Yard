import { cn } from "@/lib/utils"
import { initials } from "../format"

/** A team member's initials in a hairline circle, as in the Overview's audit trail. */
export function Initials({ name, className }: { name: string; className?: string }) {
  return (
    <span aria-hidden className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-[var(--admin-hairline-strong)] bg-[#0c0c0c] text-[10.5px] font-semibold text-ink", className)}>
      {initials(name) || "?"}
    </span>
  )
}
