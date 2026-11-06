"use client"

import { useState } from "react"
import { Chip } from "@/components/market/catalog/chip"
import { aestheticLabels, categories } from "@/lib/data"
import { useSession } from "@/lib/stores/session"
import { cn } from "@/lib/utils"
import type { Aesthetic } from "@/lib/data/types"

function toggle<T>(list: T[], v: T) {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v]
}

/** Shopping interests as chips. Each tap saves to the session, so recommendations follow at once. */
export function InterestEditor({ className }: { className?: string }) {
  const interests = useSession((s) => s.interests)
  const aesthetics = useSession((s) => s.aesthetics)
  const setInterests = useSession((s) => s.setInterests)
  const [changed, setChanged] = useState(false)

  return (
    <div className={cn("grid gap-7", className)}>
      <fieldset>
        <legend className="text-sm text-ink">Categories</legend>
        <div className="mt-3 flex flex-wrap gap-2">
          {categories.map((c) => (
            <Chip
              key={c.slug}
              selected={interests.includes(c.slug)}
              onClick={() => {
                setInterests(toggle(interests, c.slug), aesthetics)
                setChanged(true)
              }}
            >
              {c.name}
            </Chip>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-sm text-ink">Aesthetics</legend>
        <div className="mt-3 flex flex-wrap gap-2">
          {(Object.keys(aestheticLabels) as Aesthetic[]).map((a) => (
            <Chip
              key={a}
              selected={aesthetics.includes(a)}
              onClick={() => {
                setInterests(interests, toggle(aesthetics, a))
                setChanged(true)
              }}
            >
              {aestheticLabels[a]}
            </Chip>
          ))}
        </div>
      </fieldset>
      <p aria-live="polite" className="text-xs text-ink-3">
        {changed ? "Saved. Recommendations and suggested brands use your new picks straight away." : "Changes save as you tap."}
      </p>
    </div>
  )
}
