"use client"

import Image from "next/image"
import Link from "next/link"
import { useMemo, useState } from "react"
import { DiceFiveIcon as Dices, ArrowCounterClockwiseIcon as RetryIcon } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { SectionHeader } from "@/components/market/section-header"
import { useHydrated } from "@/hooks/use-hydrated"
import { useApi } from "@/lib/api/use-api"
import { errorMessage } from "@/lib/api/errors"
import { dropEntryStatus, dropImageSrc, type PublicDropDto } from "@/lib/api/drops"
import { refreshServerSession, useServerSession } from "@/lib/session/use-server-session"
import { useSaved } from "@/lib/stores/saved"
import { drops as demoDrops } from "@/lib/data"
import { YouNav } from "./you-nav"
import { usePageSampleData } from "@/components/sample/sample-data-context"
import { loadMyDrops, myDropsKey, type MyDropsResponse } from "./my-drops"

const localDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })
const utcDate = new Intl.DateTimeFormat("en-GB", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" })

function showTime(value: string, hydrated: boolean) {
  return (hydrated ? localDate : utcDate).format(new Date(value))
}

function demoParticipation(ids: string[]): MyDropsResponse {
  const selected = ids.flatMap((id) => {
    const drop = demoDrops.find((item) => item.id === id)
    return drop ? [drop] : []
  })
  return {
    entries: selected.filter((drop) => drop.access === "draw").map((drop) => ({
      drop: {
        id: drop.id,
        slug: drop.slug,
        brand: { id: drop.brandId, handle: null, name: null },
        name: drop.name,
        description: drop.description,
        image: drop.image.src,
        access: "draw",
        status: "scheduled",
        phase: "upcoming",
        startsAt: new Date(Date.now() + drop.releaseOffsetHours * 3_600_000).toISOString(),
        endsAt: new Date(Date.now() + (drop.releaseOffsetHours + drop.durationHours) * 3_600_000).toISOString(),
        earlyAccessAt: null,
        entryOpensAt: null,
        entryClosesAt: null,
        drawnAt: null,
        purchaseWindowMinutes: null,
        winners: null,
        limitPerCustomer: drop.limitPerCustomer,
        totalUnits: drop.totalUnits,
        productIds: drop.productIds,
        entries: null,
        sponsored: false,
        version: 1,
      },
      status: "entered",
      rank: null,
      windowOpensAt: null,
      windowEndsAt: null,
      enteredAt: new Date().toISOString(),
    })),
    reminders: selected.filter((drop) => drop.access !== "draw").map((drop) => ({
      dropId: drop.id,
      setAt: new Date().toISOString(),
      drop: {
        id: drop.id,
        slug: drop.slug,
        brand: { id: drop.brandId, handle: null, name: null },
        name: drop.name,
        description: drop.description,
        image: drop.image.src,
        access: drop.access === "early-access" ? "early_access" : "first_come",
        status: "scheduled",
        phase: "upcoming",
        startsAt: new Date(Date.now() + drop.releaseOffsetHours * 3_600_000).toISOString(),
        endsAt: new Date(Date.now() + (drop.releaseOffsetHours + drop.durationHours) * 3_600_000).toISOString(),
        earlyAccessAt: null,
        entryOpensAt: null,
        entryClosesAt: null,
        drawnAt: null,
        purchaseWindowMinutes: null,
        winners: null,
        limitPerCustomer: drop.limitPerCustomer,
        totalUnits: drop.totalUnits,
        productIds: drop.productIds,
        entries: null,
        sponsored: false,
        version: 1,
      },
    })),
  }
}

function DropRow({ drop, caption, status, children }: { drop: PublicDropDto; caption: string; status?: string; children?: React.ReactNode }) {
  const result = status ? dropEntryStatus(status) : null
  return <article className="flex min-w-0 flex-col gap-4 border-b border-line-soft py-5 sm:flex-row sm:items-center">
    <Link href={`/drops/${drop.slug}`} className="relative aspect-[4/3] w-full shrink-0 overflow-hidden rounded-md bg-card sm:size-24 sm:aspect-auto">
      <Image src={dropImageSrc(drop.image)} alt={drop.name} fill unoptimized={dropImageSrc(drop.image).startsWith("/api/")} sizes="(min-width: 640px) 96px, 90vw" className="object-cover" />
    </Link>
    <div className="grid min-w-0 flex-1 gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {drop.brand.name ? <span className="text-xs text-ink-3">{drop.brand.name}</span> : null}
        {result ? <StatusBadge tone={result.tone}>{result.label}</StatusBadge> : null}
      </div>
      <Link href={`/drops/${drop.slug}`} className="truncate text-base font-medium text-ink hover:text-violet">{drop.name}</Link>
      <p className="text-sm text-ink-2">{caption}</p>
      {drop.access === "draw" && status === "won" && drop.purchaseWindowMinutes ? <p className="text-xs text-ink-3">Purchase window: {drop.purchaseWindowMinutes >= 1440 ? `${Math.floor(drop.purchaseWindowMinutes / 1440)} day${drop.purchaseWindowMinutes >= 2880 ? "s" : ""}` : `${drop.purchaseWindowMinutes} minutes`}</p> : null}
    </div>
    {children ? <div className="flex shrink-0 items-center">{children}</div> : null}
  </article>
}

function DropList({ response, hydrated }: { response: MyDropsResponse; hydrated: boolean }) {
  const entries = response.entries.filter((entry) => entry.status !== "withdrawn")
  const reminders = response.reminders.filter((reminder) => reminder.drop)
  return <>
    <section aria-labelledby="my-draws" className="mt-12">
      <SectionHeader title="Draw entries" description="Results and winner purchase windows." />
      {entries.length ? <div className="mt-2 divide-y divide-line-soft">
        {entries.map((entry) => <DropRow key={entry.drop.id} drop={entry.drop} status={entry.status} caption={
          entry.status === "won" && entry.windowEndsAt ? `Purchase by ${showTime(entry.windowEndsAt, hydrated)}${hydrated ? " · your time" : ""}` :
          entry.status === "entered" ? `Entered ${showTime(entry.enteredAt, hydrated)}${hydrated ? " · your time" : ""}` :
          entry.rank ? `Queue position ${entry.rank}` : "Draw result is available on the drop page."
        } />)}
      </div> : <p className="mt-4 text-sm text-ink-3">You haven&apos;t entered a draw yet.</p>}
    </section>
    <section aria-labelledby="my-reminders" className="mt-12">
      <SectionHeader title="Reminders" description="Drops you asked us to notify you about." />
      {reminders.length ? <div className="mt-2 divide-y divide-line-soft">
        {reminders.map((reminder) => <DropRow key={reminder.dropId} drop={reminder.drop!} caption={`Reminder set ${showTime(reminder.setAt, hydrated)}${hydrated ? " · your time" : ""}`} />)}
      </div> : <p className="mt-4 text-sm text-ink-3">You haven&apos;t set a drop reminder yet.</p>}
    </section>
  </>
}

export function DropsView() {
  const hydrated = useHydrated()
  const session = useServerSession()
  const localReminders = useSaved((state) => state.notify)
  const isLiveShopper = session.status === "ready" && !!session.shopper && !session.shopper.demo
  const query = useApi(isLiveShopper ? myDropsKey(session.shopper!.id) : null, loadMyDrops, { keepPrevious: false })
  // The sample drops only in demo: production never resolves a local reminder against them.
  const sampleOn = usePageSampleData()
  const demo = useMemo(() => demoParticipation(sampleOn ? localReminders : []), [localReminders, sampleOn])
  const [retrying, setRetrying] = useState(false)

  return <>
    <header>
      <p className="text-sm text-violet">Your World</p>
      <h1 className="mt-2 font-display text-display-lg text-ink">Your drops</h1>
      <p className="mt-4 max-w-xl text-pretty text-[0.9375rem] leading-relaxed text-ink-2">Every draw you enter and every reminder you set, across the brands you follow.</p>
    </header>
    <YouNav className="mt-8" />
    {session.status === "loading" ? <div role="status" className="mt-12 rounded-lg border border-line-soft p-6 text-sm text-ink-3">Loading your drops…</div> : session.status === "error" ? (
      <div role="alert" className="mt-12 grid max-w-xl gap-3 rounded-lg border border-line-soft bg-card p-5">
        <p className="text-sm text-ink">Your account couldn&apos;t be loaded.</p>
        <p className="text-sm text-ink-2">Check your connection and try again.</p>
        <Button variant="secondary" size="sm" className="w-fit" loading={retrying} onClick={() => { setRetrying(true); void refreshServerSession().finally(() => setRetrying(false)) }}><RetryIcon /> Try again</Button>
      </div>
    ) : isLiveShopper ? query.error && !query.data ? (
      <div role="alert" className="mt-12 grid max-w-xl gap-3 rounded-lg border border-line-soft bg-card p-5">
        <p className="text-sm text-ink">Your drops couldn&apos;t be loaded.</p>
        <p className="text-sm text-ink-2">{errorMessage(query.error)}</p>
        <Button variant="secondary" size="sm" className="w-fit" loading={query.isValidating} onClick={() => void query.revalidate()}><RetryIcon /> Try again</Button>
      </div>
    ) : query.isLoading && !query.data ? <div role="status" className="mt-12 rounded-lg border border-line-soft p-6 text-sm text-ink-3">Loading your drops…</div> : <DropList response={query.data ?? { entries: [], reminders: [] }} hydrated={hydrated} /> : <DropList response={demo} hydrated={hydrated} />}
    {!isLiveShopper && session.status === "ready" && session.shopper?.demo ? <p className="mt-10 text-xs text-ink-3">Demo reminders and entries are saved in this browser. Live draw results are available on real shopper accounts.</p> : null}
    <div className="mt-10">
      <Button asChild variant="secondary" size="sm"><Link href="/drops"><Dices /> Explore drops</Link></Button>
    </div>
  </>
}