import { cn } from "@/lib/utils"
import { initials } from "../format"
import { PhotoOrInitials } from "@/components/media/person-photo"

/** A team member's initials (or profile photo) in a hairline circle, as in the Overview's audit trail. */
export function Initials({ name, photo, className }: { name: string; photo?: string | null; className?: string }) {
  return (
    <span aria-hidden className={cn("inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--admin-hairline-strong)] bg-[#0c0c0c] text-[10.5px] font-semibold text-ink", className)}>
      <PhotoOrInitials src={photo}>{initials(name) || "?"}</PhotoOrInitials>
    </span>
  )
}
