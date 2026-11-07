"use client"

import { useCallback, useState } from "react"
import { NavigationArrowIcon } from "@phosphor-icons/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { AreaSearch } from "./area-search"

/**
 * Locate (§5.6, §6.4 permission flow). Geolocation is never called on load: only after a tap, and
 * only after the explainer unless the browser already allows it. The fix is handed to `onFix`
 * and lives in React state only — never storage, never a URL, never a request.
 */

export const EXPLAINER =
  "Yard uses it on this device to show what's near you and how far it is. It isn't sent to Yard or to brands. Street maps load from OpenFreeMap, which sees the area you're looking at, like any map site."

type SheetState = "explain" | "denied" | null

export function useLocate(onFix: (pos: { lat: number; lng: number }) => void, onPickArea: () => void) {
  const [sheet, setSheet] = useState<SheetState>(null)
  const [locating, setLocating] = useState(false)

  const fix = useCallback(() => {
    if (!("geolocation" in navigator)) {
      toast("Couldn't get your location. Pick an area instead.")
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        onFix({ lat: pos.coords.latitude, lng: pos.coords.longitude })
      },
      (err) => {
        setLocating(false)
        if (err.code === err.PERMISSION_DENIED) setSheet("denied")
        else toast("Couldn't get your location. Pick an area instead.")
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    )
  }, [onFix])

  const start = useCallback(async () => {
    let state: PermissionState = "prompt"
    try {
      const status = await navigator.permissions?.query({ name: "geolocation" as PermissionName })
      if (status) state = status.state
    } catch {
      /* no Permissions API: explain first */
    }
    if (state === "granted") fix()
    else if (state === "denied") setSheet("denied")
    else setSheet("explain")
  }, [fix])

  const sheets = (
    <LocateSheets
      state={sheet}
      onClose={() => setSheet(null)}
      onUse={() => {
        setSheet(null)
        fix()
      }}
      onPick={() => {
        setSheet(null)
        onPickArea()
      }}
    />
  )
  return { start, locating, sheets }
}

function LocateSheets({ state, onClose, onUse, onPick }: { state: SheetState; onClose: () => void; onUse: () => void; onPick: () => void }) {
  const [last, setLast] = useState<SheetState>(state)
  if (state && state !== last) setLast(state)
  const shown = state ?? last
  return (
    <Sheet open={!!state} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="mx-auto max-w-lg rounded-t-2xl border-white/10 bg-[var(--glass-bg-strong)] backdrop-blur-xl lg:bottom-6 lg:rounded-2xl lg:border">
        {shown === "denied" ? (
          <>
            <SheetHeader className="pr-12">
              <SheetTitle>Location is off for Yard</SheetTitle>
              <SheetDescription className="text-ink-2">Location is off for Yard in your browser settings. Pick a city or neighbourhood instead.</SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-6">
              <AreaSearch variant="inline" onChosen={onClose} />
            </div>
          </>
        ) : (
          <>
            <SheetHeader className="pr-12">
              <span className="mb-2 inline-flex size-10 items-center justify-center rounded-full border border-white/10 text-ink">
                <NavigationArrowIcon className="size-5" aria-hidden />
              </span>
              <SheetTitle>Use your location?</SheetTitle>
              <SheetDescription className="text-ink-2">{EXPLAINER}</SheetDescription>
            </SheetHeader>
            <SheetFooter className="pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row-reverse">
              <Button variant="primary" onClick={onUse} className="sm:flex-1">
                Use my location
              </Button>
              <Button variant="secondary" onClick={onPick} className="sm:flex-1">
                Pick an area instead
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
