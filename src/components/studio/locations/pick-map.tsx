"use client"

import { useState } from "react"
import { AroundMap, type Enhancement } from "@/components/around/map/around-map"
import { Input } from "@/components/ui/input"
import { FieldMessage, control } from "@/components/studio/catalog/fields"

/**
 * Pick mode (§6.4 On the map): Yard's bundled map at zoom 14 with neighbourhood labels and one
 * draggable pin, plus latitude and longitude fields kept in step with it. The copy says plainly
 * when street tiles didn't load, because then the pin can only be placed by area.
 */
export function PickMap({
  lat,
  lng,
  latText,
  lngText,
  onPin,
  onTyped,
  areaName,
  enhancement,
  onEnhancement,
  error,
}: {
  lat: number
  lng: number
  latText: string
  lngText: string
  /** The pin was dragged. */
  onPin: (p: { lat: number; lng: number }) => void
  /** A coordinate was typed (raw text; the form parses it). */
  onTyped: (field: "lat" | "lng", text: string) => void
  areaName: string
  enhancement: Enhancement
  onEnhancement: (e: Enhancement) => void
  error?: string
}) {
  const [fallback, setFallback] = useState(false)
  const copy =
    enhancement === "ready"
      ? "Drag the pin onto your door, or type the coordinates."
      : enhancement === "loading"
        ? "Loading the street map…"
        : `The street map couldn't load, so your pin starts at the ${areaName} centre. Shoppers get directions from your address line.`
  return (
    <div className="grid gap-2">
      <p className="text-[13px] text-ink">Pin</p>
      <p id="loc-pin-copy" className="text-xs text-ink-2">
        {fallback ? "This browser can't show the map. Type the coordinates instead." : copy}
      </p>
      {fallback ? null : (
        <AroundMap
          mode="pick"
          initialCamera={{ center: { lat, lng }, zoom: 14 }}
          pick={{ lat, lng }}
          onPick={onPin}
          onEnhancement={onEnhancement}
          onFallback={() => setFallback(true)}
          className="h-64 rounded-lg border border-line-soft md:h-80"
          label="Map for placing the pin"
        />
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <label htmlFor="loc-lat" className="text-[13px] text-ink">
            Latitude
          </label>
          <Input {...control("loc-lat", error, true)} inputMode="decimal" value={latText} onChange={(e) => onTyped("lat", e.target.value)} className="h-11 md:h-9" autoComplete="off" />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="loc-lng" className="text-[13px] text-ink">
            Longitude
          </label>
          <Input {...control("loc-lng", error)} inputMode="decimal" value={lngText} onChange={(e) => onTyped("lng", e.target.value)} className="h-11 md:h-9" autoComplete="off" />
        </div>
      </div>
      <FieldMessage id="loc-lat" error={error} hint="Decimal degrees, like 6.5095 and 3.3711. Typed coordinates count as a precise pin." />
    </div>
  )
}
