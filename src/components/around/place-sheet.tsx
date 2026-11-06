"use client"

import { useRef, useState } from "react"
import type { PlaceDetailDto, PlaceSummaryDto } from "@/lib/api/contracts/around"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { PlaceDetail } from "./place-detail"

/**
 * PlaceSheet (§6.4, phones): a bottom sheet at 64 dvh with a drag handle, expandable to 92 dvh.
 * Esc closes it, and so does Back (opening it pushed a history entry).
 */
export function PlaceSheet({
  open,
  onClose,
  summary,
  detail,
  loading,
  error,
  onRetry,
  now,
  distance,
}: {
  open: boolean
  onClose: () => void
  summary?: PlaceSummaryDto | null
  detail?: PlaceDetailDto | null
  loading: boolean
  error: unknown
  onRetry: () => void
  now: number
  distance?: { km: number; from: string } | null
}) {
  const [expanded, setExpanded] = useState(false)
  const drag = useRef<{ y: number; id: number } | null>(null)
  const dragged = useRef(false)
  const p = detail ?? summary
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setExpanded(false)
          onClose()
        }
      }}
    >
      <SheetContent
        side="bottom"
        showCloseButton
        className={cn("gap-0 overflow-hidden rounded-t-2xl border-white/10 bg-[var(--glass-bg-strong)] p-0 backdrop-blur-xl transition-[height] duration-300 motion-reduce:transition-none lg:inset-x-auto lg:right-1/2 lg:w-[560px] lg:translate-x-1/2 lg:rounded-2xl lg:border", expanded ? "h-[92dvh]" : "h-[64dvh]")}
      >
        <SheetTitle className="sr-only">{p ? `${p.brand.name}, ${p.name}` : "Place"}</SheetTitle>
        <SheetDescription className="sr-only">Details, opening hours, events and the storefront link for this place.</SheetDescription>
        <button
          type="button"
          aria-label={expanded ? "Make the sheet smaller" : "Expand the sheet"}
          aria-expanded={expanded}
          onClick={() => {
            if (dragged.current) {
              dragged.current = false
              return
            }
            setExpanded((x) => !x)
          }}
          onPointerDown={(e) => {
            drag.current = { y: e.clientY, id: e.pointerId }
            e.currentTarget.setPointerCapture(e.pointerId)
          }}
          onPointerUp={(e) => {
            const d = drag.current
            drag.current = null
            if (!d) return
            const dy = e.clientY - d.y
            dragged.current = Math.abs(dy) > 10
            if (dy < -30) setExpanded(true)
            else if (dy > 60) {
              if (expanded) setExpanded(false)
              else onClose()
            }
          }}
          className="flex h-8 w-full shrink-0 touch-none items-center justify-center"
        >
          <span aria-hidden className="h-1 w-10 rounded-full bg-white/25" />
        </button>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <PlaceDetail summary={summary} detail={detail} loading={loading} error={error} onRetry={onRetry} now={now} distance={distance} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
