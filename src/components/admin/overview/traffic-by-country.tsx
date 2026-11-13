"use client"

import { useState } from "react"
import { GlobeHemisphereWestIcon, WarningIcon } from "@phosphor-icons/react"
import { EmptyState } from "@/components/dashboard/empty-state"
import { Bone } from "@/components/feedback/skeletons"
import { Panel } from "@/components/admin/ui/panel"
import { Segmented } from "@/components/admin/ui/segmented"
import { api } from "@/lib/api/client"
import { useApi } from "@/lib/api/use-api"
import { cn } from "@/lib/utils"
import type { TrafficReport } from "@/server/traffic"

type Report = TrafficReport & { geoReady: boolean }
type Range = "1" | "7" | "30" | "90"

const RANGES: { value: Range; label: string }[] = [
  { value: "1", label: "Today" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
]
const SHOWN = 12

const int = (n: number) => n.toLocaleString("en-US")
const regionNames = typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames(["en"], { type: "region" }) : null
function countryName(code: string) {
  if (code === "ZZ") return "Unknown"
  try {
    return regionNames?.of(code) ?? code
  } catch {
    return code
  }
}
/** Regional-indicator flag emoji for a two-letter code; a globe for unknown. */
function flag(code: string) {
  if (!/^[A-Z]{2}$/.test(code) || code === "ZZ") return "🌐"
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}

/** Marketplace page views and visitors by country, from the visitor's IP (never stored). */
export function TrafficByCountry({ className }: { className?: string }) {
  const [range, setRange] = useState<Range>("7")
  const [all, setAll] = useState(false)
  const q = useApi(`admin:traffic:${range}`, () => api<Report>(`/api/admin/traffic?days=${range}`), { refreshInterval: 60_000 })
  const r = q.data
  const top = r?.countries[0]?.views ?? 0
  const rows = r ? (all ? r.countries : r.countries.slice(0, SHOWN)) : []

  return (
    <Panel
      id="traffic"
      title="Traffic by country"
      description={r ? `${int(r.totals.views)} page views · ${int(r.totals.visitors)} visitors · ${r.totals.countries} ${r.totals.countries === 1 ? "country" : "countries"}` : "Marketplace page views by where visitors are"}
      action={<Segmented size="sm" label="Traffic range" value={range} onChange={(v) => { setRange(v); setAll(false) }} options={RANGES} />}
      className={cn("scroll-mt-24 rounded-[20px]", className)}
    >
      {q.error && !r ? (
        <EmptyState icon={WarningIcon} title="Couldn't load traffic" body="The traffic endpoint didn't answer. It retries every minute." />
      ) : !r ? (
        <div className="grid gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Bone key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : r.countries.length === 0 ? (
        <EmptyState icon={GlobeHemisphereWestIcon} title="No visits counted yet" body={range === "1" ? "Marketplace page views appear here within a minute of someone visiting." : "Marketplace page views appear here within a minute of someone visiting. Counting started with this update."} />
      ) : (
        <div className="grid gap-3">
          <ol className="grid gap-1.5">
            {rows.map((c, i) => {
              const share = r.totals.views ? c.views / r.totals.views : 0
              return (
                <li key={c.country} className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-lg px-1 py-1.5">
                  <span className="text-right text-[12px] text-ink-3 tabular-nums">{i + 1}</span>
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span aria-hidden className="text-base leading-none">{flag(c.country)}</span>
                      <span className="truncate text-[14px] text-ink">{countryName(c.country)}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--admin-hairline)]">
                      <div className={cn("h-full rounded-full", c.country === "ZZ" ? "bg-ink-3" : "bg-violet")} style={{ width: `${top ? Math.max(2, (c.views / top) * 100) : 0}%` }} />
                    </div>
                  </div>
                  <div className="text-right tabular-nums">
                    <p className="text-[14px] text-ink">{int(c.views)}</p>
                    <p className="text-[12px] text-ink-3">{(share * 100).toFixed(share > 0 && share < 0.01 ? 1 : 0)}% · {int(c.visitors)} {c.visitors === 1 ? "visitor" : "visitors"}</p>
                  </div>
                </li>
              )
            })}
          </ol>
          {r.countries.length > SHOWN ? (
            <button type="button" onClick={() => setAll((v) => !v)} className="justify-self-start rounded-md px-1 text-[13px] text-violet underline-offset-4 hover:underline">
              {all ? "Show top countries" : `Show all ${r.countries.length} countries`}
            </button>
          ) : null}
        </div>
      )}
      <p className="mt-4 text-[12px] text-ink-3">
        {r && !r.geoReady ? "The country database is not installed on the server yet, so visits show as Unknown. " : ""}
        Counts update every minute; days are UTC. Crawlers are not counted, and no IP addresses are stored.{" "}
        <a href="https://db-ip.com" target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">IP Geolocation by DB-IP</a>
      </p>
    </Panel>
  )
}
