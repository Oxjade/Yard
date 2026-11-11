"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowUpRightIcon as ArrowUpRight } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { NotifyButton } from "@/components/market/notify-button"
import { useHydrated } from "@/hooks/use-hydrated"
import { useNow } from "@/hooks/use-now"
import { api } from "@/lib/api/client"
import { errorMessage } from "@/lib/api/errors"
import { dropAccessForButton, dropActionMode, dropEntryStatus, dropPhaseAt, type PublicDropDetailDto } from "@/lib/api/drops"

const localDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })
const utcDate = new Intl.DateTimeFormat("en-GB", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" })
const show = (value: string, hydrated: boolean) => `${(hydrated ? localDate : utcDate).format(new Date(value))}${hydrated ? " (your time)" : ""}`

const ACCESS_RULE = {
  first_come: "Opens to everyone at release. Pieces go to whoever checks out first.",
  early_access: "Followers who were following before early access opened get the first window. Everyone can buy at the public release.",
  draw: "Enter before release. Winners are picked at random and only winners can buy, within their purchase window.",
} as const

/**
 * The release panel on a product page for a piece in a brand's drop (database drops): when it
 * releases, its rules, the shopper's own state (me.reason when they can't buy yet) and the
 * reminder or draw entry. Checkout enforces the drop's limits; this only explains them.
 */
export function LiveProductDrop({ slug }: { slug: string }) {
  const hydrated = useHydrated()
  const now = useNow(30_000)
  const [state, setState] = useState<{ kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; detail: PublicDropDetailDto }>({ kind: "loading" })
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    void api<PublicDropDetailDto>(`/api/drops/${encodeURIComponent(slug)}`, { signal: controller.signal })
      .then((detail) => setState({ kind: "ready", detail }))
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setState((current) => (current.kind === "ready" ? current : { kind: "error", message: errorMessage(cause, "This piece's drop couldn't be loaded.") }))
      })
    return () => controller.abort()
  }, [slug, reload])

  if (state.kind === "loading") return <div role="status" aria-label="Loading drop" className="h-36 animate-pulse rounded-lg border border-line bg-card" />
  if (state.kind === "error") return (
    <div role="alert" className="grid gap-3 rounded-lg border border-line bg-card p-4 sm:p-5">
      <p className="text-sm text-ink-2">{state.message}</p>
      <Button variant="secondary" size="sm" className="w-fit" onClick={() => { setState({ kind: "loading" }); setReload((value) => value + 1) }}>Retry</Button>
    </div>
  )

  const { drop, me } = state.detail
  const phase = dropPhaseAt(drop, now)
  if (phase === "ended") return null
  const mode = dropActionMode(drop, phase)
  const status = phase === "entries_open" ? "Entries open" : phase === "early_access" ? "Early access" : phase === "live" ? (drop.access === "draw" ? "Winners buying" : "Live now") : "Upcoming"
  const timing =
    drop.access === "draw" && phase === "upcoming" && drop.entryOpensAt ? `Entries open ${show(drop.entryOpensAt, hydrated)}`
    : phase === "entries_open" ? `Entries close ${show(drop.entryClosesAt ?? drop.startsAt, hydrated)}`
    : phase === "live" ? `${drop.access === "draw" ? "Winners can buy until" : "Closes"} ${show(drop.endsAt, hydrated)}`
    : `Releases ${show(drop.startsAt, hydrated)}`
  const won = me?.entry?.status === "won"

  return (
    <section aria-labelledby="pdp-live-drop-title" className="rounded-lg border border-line bg-card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="rounded-sm bg-elevated px-2 py-1 text-[11px] text-ink">{status}</span>
        <Link href={`/drops/${drop.slug}`} className="group -my-3 -mr-1 inline-flex min-h-10 items-center gap-1 rounded-md px-1 text-xs text-ink-2 transition-colors hover:text-ink">
          Drop details
          <ArrowUpRight className="size-3.5 transition-transform duration-300 ease-out-quint group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </Link>
      </div>
      <h2 id="pdp-live-drop-title" className="mt-4 text-base font-medium break-words text-ink">{drop.name}</h2>
      <p className="mt-1 text-sm text-ink-2">{timing}</p>
      {won && me?.canBuy && me.entry?.windowEndsAt ? <p className="mt-3 text-sm text-ink">You won the draw. Buy by {show(me.entry.windowEndsAt, hydrated)}.</p> : null}
      {me && !me.canBuy && me.reason ? <p role="status" className="mt-3 border-l-2 border-line py-1 pl-3 text-sm text-ink-2">{me.reason}</p> : null}
      {me?.entry && !won ? <p className="mt-2 text-xs text-ink-3">Your draw entry: {dropEntryStatus(me.entry.status).label}</p> : null}
      {mode ? (
        <div className="mt-4">
          <NotifyButton drop={{ id: drop.id, access: dropAccessForButton(drop.access) }} mode={mode} size="sm" onChange={() => setReload((value) => value + 1)} />
        </div>
      ) : null}
      <p className="mt-4 border-t border-line-soft pt-3 text-xs text-ink-2">{ACCESS_RULE[drop.access]} Limit {drop.limitPerCustomer} per customer. Checkout confirms availability.</p>
    </section>
  )
}
