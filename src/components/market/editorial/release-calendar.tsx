"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { CalendarX2 } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { Button } from "@/components/ui/button"
import { BrandMark } from "@/components/market/brand-mark"
import { Chip } from "@/components/market/catalog/chip"
import { NotifyButton } from "@/components/market/notify-button"
import { SponsoredTag } from "@/components/market/sponsored-tag"
import { brandById } from "@/lib/data/brands"
import { dropWindow } from "@/lib/drops"
import type { Drop } from "@/lib/data/types"
import { accessName, isSponsoredDrop, limitText } from "./drop-facts"
import { releasesInShort } from "./use-drop-phase"

type AccessFilter = "all" | Drop["access"]

const filters: { value: AccessFilter; label: string }[] = [
  { value: "all", label: "All releases" },
  { value: "first-come", label: accessName["first-come"] },
  { value: "draw", label: accessName.draw },
  { value: "early-access", label: accessName["early-access"] },
]

const DAY = 86_400_000

function startOfDay(ms: number) {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function relativeDay(dayStart: number, today: number) {
  const diff = Math.round((dayStart - today) / DAY)
  if (diff === 0) return "Today"
  if (diff === 1) return "Tomorrow"
  return `In ${diff} days`
}

/**
 * Upcoming releases as a calendar, grouped by day in the shopper's own time zone. Dates come
 * from the demo clock, so they are only rendered after mount; until then the rows show with
 * placeholder dates of the same size.
 */
export function ReleaseCalendar({ drops, now, anchor }: { drops: Drop[]; now: number | null; anchor: number | null }) {
  const [filter, setFilter] = useState<AccessFilter>("all")
  const visible = filter === "all" ? drops : drops.filter((d) => d.access === filter)
  const counts = (value: AccessFilter) => (value === "all" ? drops.length : drops.filter((d) => d.access === value).length)

  type Group = { key: string; dayStart: number | null; drops: { drop: Drop; release: number | null }[] }
  let groups: Group[]
  if (now === null || anchor === null) {
    groups = [{ key: "pending", dayStart: null, drops: visible.map((drop) => ({ drop, release: null })) }]
  } else {
    const map = new Map<number, Group>()
    for (const drop of visible) {
      const { release } = dropWindow(drop, anchor)
      const day = startOfDay(release)
      const g = map.get(day) ?? { key: String(day), dayStart: day, drops: [] }
      g.drops.push({ drop, release })
      map.set(day, g)
    }
    groups = [...map.values()].sort((a, b) => a.dayStart! - b.dayStart!)
    for (const g of groups) g.drops.sort((a, b) => a.release! - b.release!)
  }
  const today = now === null ? null : startOfDay(now)

  return (
    <div>
      <div className="rail -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="radiogroup" aria-label="Filter by release type">
        {filters.map((f) => (
          <Chip key={f.value} selected={filter === f.value} onClick={() => setFilter(f.value)} count={counts(f.value)} layoutId="release-filter" size="sm" radio>
            {f.label}
          </Chip>
        ))}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={filter}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="mt-8"
        >
          {visible.length === 0 ? (
            <div className="flex flex-col items-center gap-4 rounded-lg border border-line-soft bg-card px-6 py-14 text-center">
              <span className="inline-flex size-14 items-center justify-center rounded-full border border-line">
                <CalendarX2 className="size-6 text-ink-2" />
              </span>
              <div>
                <p className="text-base text-ink">No {accessName[filter as Drop["access"]].toLowerCase()} releases scheduled</p>
                <p className="mt-1 text-sm text-ink-2">Brands announce new drops here first. Check the other release types for now.</p>
              </div>
              <Button variant="secondary" onClick={() => setFilter("all")}>
                Show all releases
              </Button>
            </div>
          ) : (
            <div className="grid gap-10 md:gap-12">
              {groups.map((g) => (
                <section key={g.key} aria-label={g.dayStart === null ? "Upcoming releases" : new Date(g.dayStart).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })} className="border-t border-line pt-5 md:grid md:grid-cols-[200px_minmax(0,1fr)] md:gap-8 lg:grid-cols-[240px_minmax(0,1fr)]">
                  <header className="md:sticky md:top-28 md:self-start">
                    {g.dayStart === null || today === null ? (
                      <div aria-hidden>
                        <div className="h-8 w-40 animate-pulse rounded-md bg-card md:h-9" />
                        <div className="mt-2 h-4 w-20 animate-pulse rounded bg-card" />
                      </div>
                    ) : (
                      <>
                        <p className="font-display text-display-sm text-ink">
                          {new Date(g.dayStart).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
                        </p>
                        <p className="mt-1.5 text-sm text-ink-2">
                          {relativeDay(g.dayStart, today)}, {g.drops.length} {g.drops.length === 1 ? "release" : "releases"}
                        </p>
                      </>
                    )}
                  </header>
                  <ul className="mt-3 divide-y divide-line-soft md:mt-0">
                    {g.drops.map(({ drop, release }) => (
                      <CalendarRow key={drop.id} drop={drop} release={release} now={now} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function CalendarRow({ drop, release, now }: { drop: Drop; release: number | null; now: number | null }) {
  const brand = brandById.get(drop.brandId)!
  const href = `/drops/${drop.slug}`
  const time = release === null ? null : new Date(release).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  const soon = release !== null && now !== null && release - now < DAY
  const until = release !== null && now !== null ? `in ${releasesInShort(release - now)}` : null

  return (
    <li className="flex gap-4 py-4 first:pt-1 md:grid md:grid-cols-[84px_88px_minmax(0,1fr)_180px_148px] md:items-center md:gap-6 md:py-5 md:first:pt-0">
      {/* Time: its own column on desktop, inline above the name on phones */}
      <div className="hidden md:block">
        {time === null ? (
          <div aria-hidden className="h-6 w-14 animate-pulse rounded bg-card" />
        ) : (
          <>
            <p className="text-lg text-ink tabular">{time}</p>
            <p className={soon ? "text-xs text-acid" : "text-xs text-ink-3"}>{until}</p>
          </>
        )}
      </div>

      <Link href={href} className="relative block aspect-[4/5] w-[76px] shrink-0 self-start overflow-hidden rounded-md bg-card md:w-auto" aria-label={drop.name}>
        <Image src={drop.image.src} alt={drop.image.alt} fill sizes="96px" className="object-cover" />
      </Link>

      <div className="min-w-0 flex-1 md:contents">
        <div className="min-w-0">
          <p className="mb-1.5 text-xs md:hidden">
            {time === null ? (
              <span aria-hidden className="inline-block h-3.5 w-24 animate-pulse rounded bg-card align-middle" />
            ) : (
              <>
                <span className="text-ink tabular">{time}</span> <span className={soon ? "text-acid" : "text-ink-3"}>{until}</span>
              </>
            )}
          </p>
          <div className="flex items-center gap-2">
            <BrandMark brand={brand} size="xs" />
            <Link href={`/brands/${brand.handle}`} className="truncate text-xs text-ink-2 transition-colors hover:text-violet">
              {brand.name}
            </Link>
            {isSponsoredDrop(drop) ? <SponsoredTag className="ml-1" /> : null}
          </div>
          <h3 className="mt-1.5 text-base font-medium text-ink md:text-lg">
            <Link href={href} className="hover:text-violet">{drop.name}</Link>
          </h3>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-2 md:mt-0 md:text-sm">
          {accessName[drop.access]}
          <span className="block text-ink-3 md:text-xs">{limitText(drop)}</span>
        </p>
        <div className="mt-3 md:mt-0 md:justify-self-end">
          <NotifyButton drop={drop} size="sm" />
        </div>
      </div>
    </li>
  )
}
