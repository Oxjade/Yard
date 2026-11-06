"use client"

import { Suspense } from "react"
import Image from "next/image"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { CalendarXIcon as CalendarX2 } from "@phosphor-icons/react"
import { AnimatePresence, motion } from "motion/react"
import { Bone } from "@/components/feedback/skeletons"
import { Button } from "@/components/ui/button"
import { BrandMark } from "@/components/market/brand-mark"
import { Chip, ChipRadioGroup } from "@/components/market/catalog/chip"
import { SponsoredTag } from "@/components/market/sponsored-tag"
import { brandById } from "@/lib/data/brands"
import { dropWindow } from "@/lib/drops"
import { duration, ease } from "@/lib/motion"
import type { Drop } from "@/lib/data/types"
import { DropReminderButton } from "./drop-actions"
import { accessName, isSponsoredDrop, limitText } from "./drop-facts"
import { EmptyCard } from "./empty-card"
import { releasesInShort } from "./use-drop-phase"

type AccessFilter = "all" | Drop["access"]

const filters: { value: AccessFilter; label: string }[] = [
  { value: "all", label: "All releases" },
  { value: "first-come", label: accessName["first-come"] },
  { value: "draw", label: accessName.draw },
  { value: "early-access", label: accessName["early-access"] },
]

const DAY = 86_400_000

const isAccess = (v: string | null): v is Drop["access"] => filters.some((f) => f.value !== "all" && f.value === v)

/**
 * Writes the release type to the URL (?type=) without a navigation; useSearchParams follows it.
 * Filter rows on /brands, /stories and /drops all replace the entry, like the shop's filters,
 * so Back leaves the page instead of stepping through every chip that was tried.
 */
function writeType(next: AccessFilter) {
  const url = new URL(window.location.href)
  if (next === "all") url.searchParams.delete("type")
  else url.searchParams.set("type", next)
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`)
}

type CalendarProps = { drops: Drop[]; now: number | null; anchor: number | null }

/** Reads ?type= from the URL; must sit inside <Suspense>. */
function UrlReleaseCalendar(props: CalendarProps) {
  const fromUrl = useSearchParams().get("type")
  return <ReleaseCalendarView {...props} filter={isAccess(fromUrl) ? fromUrl : "all"} />
}

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
 * placeholder dates of the same size. The release-type filter lives in the URL (?type=), so a
 * filtered calendar survives a reload and can be shared; the static page renders it unfiltered.
 */
export function ReleaseCalendar(props: CalendarProps) {
  return (
    <Suspense fallback={<ReleaseCalendarView {...props} filter="all" />}>
      <UrlReleaseCalendar {...props} />
    </Suspense>
  )
}

function ReleaseCalendarView({ drops, now, anchor, filter }: CalendarProps & { filter: AccessFilter }) {
  const setFilter = writeType
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
      <ChipRadioGroup label="Filter by release type" className="rail -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {filters.map((f) => (
          <Chip key={f.value} selected={filter === f.value} onClick={() => setFilter(f.value)} count={counts(f.value)} layoutId="release-filter" size="sm" radio>
            {f.label}
          </Chip>
        ))}
      </ChipRadioGroup>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={filter}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4, transition: { duration: 0.14, ease: ease.in } }}
          transition={{ duration: duration.page, ease: ease.out }}
          className="mt-8"
        >
          {visible.length === 0 ? (
            <EmptyCard
              icon={<CalendarX2 />}
              title={`No ${accessName[filter as Drop["access"]].toLowerCase()} releases scheduled`}
              reason="Brands announce new drops here first; the other release types have dates set."
              action={
                <Button variant="secondary" onClick={() => setFilter("all")}>
                  Show all releases
                </Button>
              }
            />
          ) : (
            <div className="grid gap-10 md:gap-12">
              {groups.map((g) => (
                <section key={g.key} aria-label={g.dayStart === null ? "Upcoming releases" : new Date(g.dayStart).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })} className="border-t border-line pt-5 md:grid md:grid-cols-[200px_minmax(0,1fr)] md:gap-8 lg:grid-cols-[240px_minmax(0,1fr)]">
                  <header className="md:sticky md:top-28 md:self-start">
                    {g.dayStart === null || today === null ? (
                      <div aria-hidden>
                        <Bone className="h-8 w-40 md:h-9" />
                        <Bone className="mt-2 h-4 w-28" />
                      </div>
                    ) : (
                      <>
                        <p className="font-display text-display-sm text-ink">
                          {new Date(g.dayStart).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
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
  const time = release === null ? null : new Date(release).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
  const soon = release !== null && now !== null && release - now < DAY
  const until = release !== null && now !== null ? `in ${releasesInShort(release - now)}` : null

  return (
    <li className="flex gap-4 py-4 first:pt-1 md:grid md:grid-cols-[84px_88px_minmax(0,1fr)_180px_148px] md:items-center md:gap-6 md:py-5 md:first:pt-0">
      {/* Time: its own column on desktop, inline above the name on phones */}
      <div className="hidden md:block">
        {time === null ? (
          <div aria-hidden>
            <Bone className="h-6 w-16" />
            <Bone className="mt-1 h-3 w-12" />
          </div>
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
          <div className="mb-1.5 flex h-4 items-center gap-1 text-xs md:hidden">
            {time === null ? (
              <Bone className="h-3.5 w-24" />
            ) : (
              <>
                <span className="text-ink tabular">{time}</span> <span className={soon ? "text-acid" : "text-ink-3"}>{until}</span>
              </>
            )}
          </div>
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
          <DropReminderButton drop={drop} size="sm" className="h-10 md:h-8" />
        </div>
      </div>
    </li>
  )
}
