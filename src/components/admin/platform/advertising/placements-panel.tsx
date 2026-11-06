"use client"

import { useMemo } from "react"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { brandById, categoryBySlug } from "@/lib/data"
import { campaignDates, campaignTypes, type Campaign, type Placement } from "@/lib/data/ads"
import type { CategorySlug } from "@/lib/data/types"
import { useNow } from "@/hooks/use-now"
import { useAdmin } from "@/lib/stores/admin"
import { formatDay, usd } from "../format"
import { SlotDiagram } from "./creative-preview"
import { placementOrder, placementRules, typesFor } from "./placements"

const perCategory: Placement[] = ["category-grid", "search-results"]

/** How many sponsored slots one view of the placement shows filled right now. */
function filledPerView(p: Placement, live: Campaign[]) {
  if (!perCategory.includes(p)) return Math.min(live.length, placementRules[p].maxPerView)
  const byCat = new Map<string, number>()
  for (const c of live) for (const cat of c.audience.categories.length ? c.audience.categories : ["all"]) byCat.set(cat, (byCat.get(cat) ?? 0) + 1)
  return Math.min(Math.max(0, ...byCat.values()), placementRules[p].maxPerView)
}

/** Every sponsored placement, its slot rules, what it sells for and who occupies it now. */
export function PlacementsPanel({ campaigns }: { campaigns: Campaign[] }) {
  const pricing = useAdmin((s) => s.pricing)
  // End dates are the brand's calendar days, as Studio and the campaigns table give them; known
  // on the client only, so a placeholder of the same size stands in until then.
  const now = useNow(60_000)

  const rows = useMemo(
    () =>
      placementOrder.map((p) => {
        const live = campaigns.filter((c) => c.status === "active" && c.placements.includes(p))
        const waiting = campaigns.filter((c) => (c.status === "in_review" || c.status === "scheduled") && c.placements.includes(p))
        return { p, rule: placementRules[p], live, waiting, filled: filledPerView(p, live) }
      }),
    [campaigns],
  )

  return (
    <ul className="admin-divide">
      {rows.map(({ p, rule, live, waiting, filled }) => {
        const full = filled >= rule.maxPerView
        const cats = perCategory.includes(p) ? [...new Set(live.flatMap((c) => c.audience.categories))].map((s) => categoryBySlug.get(s as CategorySlug)?.name ?? s) : []
        return (
          <li key={p} className="grid gap-4 px-4 py-4 md:px-5 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1fr)] @4xl:gap-6">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-label text-[13px] text-ink">{rule.name}</h3>
                <StatusBadge tone={live.length ? (full ? "info" : "neutral") : "muted"}>{live.length ? (full ? "Fully booked" : "Partly booked") : "Open"}</StatusBadge>
              </div>
              <p className="mt-0.5 text-[11px] text-ink-3">{rule.surface}</p>
              <p className="mt-3 text-[11px] text-ink-3">Sold as</p>
              <ul className="mt-1 grid gap-1">
                {typesFor(p).map((t) => (
                  <li key={t} className="flex items-baseline justify-between gap-3 text-[12px]">
                    <span className="text-ink-2">{campaignTypes[t].name}</span>
                    <span className="text-ink tabular">
                      {usd(pricing[t])}
                      <span className="text-ink-3"> per {campaignTypes[t].unit}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="min-w-0">
              <SlotDiagram rule={rule} filled={filled} className={rule.viewSize > 8 ? "max-w-[360px]" : "max-w-[300px]"} />
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
                <div>
                  <dt className="text-[11px] text-ink-3">Designated positions</dt>
                  <dd className="mt-0.5 text-ink tabular">
                    {rule.positions.join(" and ")} of {rule.viewSize}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-ink-3">Max sponsored per view</dt>
                  <dd className="mt-0.5 text-ink tabular">{rule.maxPerView}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-[11px] text-ink-3">Organic first</dt>
                  <dd className="mt-0.5 text-ink">{rule.organicFirst}</dd>
                </div>
              </dl>
              <p className="mt-2 text-[11px] text-ink-3">{rule.note}</p>
            </div>

            <div className="min-w-0">
              <p className="text-[11px] text-ink-3">{cats.length ? `Held now, in ${cats.join(" and ")}` : "Held now"}</p>
              {live.length ? (
                <ul className="mt-1 admin-divide">
                  {live.map((c) => {
                    const end = now !== null ? campaignDates(c, now).end : null
                    return (
                      <li key={c.id} className="py-2">
                        <p className="truncate text-[13px] text-ink">{c.name}</p>
                        <p className="truncate text-[11px] text-ink-3">
                          {brandById.get(c.brandId)?.name}, until {end ? formatDay(`${end}T12:00:00Z`) : <span aria-hidden className="skeleton inline-block h-2.5 w-11 rounded-sm align-middle" />}
                        </p>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="admin-inset mt-1.5 px-3 py-2.5 text-[12px] text-ink-2">No live campaigns. Organic results fill every position.</p>
              )}
              {waiting.length ? (
                <p className="mt-1 text-[11px] text-ink-3">
                  {waiting.length} more {waiting.length === 1 ? "booking" : "bookings"} in review or scheduled
                </p>
              ) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export function SlotLegend({ className }: { className?: string }) {
  return (
    <ul className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-3 ${className ?? ""}`} aria-label="Slot legend">
      <li className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-[2px] bg-white/[0.06]" aria-hidden /> Organic
      </li>
      <li className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-[2px] bg-purple" aria-hidden /> Sponsored, booked
      </li>
      <li className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-[2px] border border-dashed border-violet/70" aria-hidden /> Sponsored, open
      </li>
    </ul>
  )
}
