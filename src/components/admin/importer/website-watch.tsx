"use client"

import { useEffect, useId, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { ArrowsClockwiseIcon, CheckIcon, CircleNotchIcon, WarningIcon, XIcon } from "@phosphor-icons/react"
import { insetClass } from "@/components/admin/marketplace/detail-sheet"
import { relativeTime } from "@/components/feedback/notification-bell"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { currencies, type CurrencyCode } from "@/config/markets"
import { IMPORT_PLATFORM_LABELS, type AdminWatchDto, type SiteChangeDto, type SitePieceDto } from "@/lib/api/contracts/imports"
import { errorMessage } from "@/lib/api/errors"
import { actOnWebsitePiece, approveAllWebsitePieces, brandWatchKey, checkBrandWatch, getBrandWatch, setBrandWatch } from "@/lib/api/imports"
import { useApi } from "@/lib/api/use-api"
import { formatMoney } from "@/lib/money"
import { cn } from "@/lib/utils"

/*
 * Watching a brand's website (docs/IMPORTER.md › Watching a website), Admin side: the "Keep
 * watching {site} for new pieces" switch, Check now / Resume, "New from their website (N)" with
 * Approve / Skip and Approve all, and "Changes on their site" (flagged only, Dismiss). The import
 * page shows all of it; the brand tray shows the waiting pieces (WebsitePiecesTray).
 */

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "")
  } catch {
    return u
  }
}

const money = (minor: number | null, currency: string | null) => (minor != null && currency && currency in currencies ? formatMoney(minor, currency as CurrencyCode) : minor != null ? `${(minor / 100).toFixed(2)} ${currency ?? ""}`.trim() : "No price")

const inFuture = (iso: string) => {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 60_000) return "any minute"
  const h = Math.round(ms / 3600_000)
  return h >= 1 ? `in about ${h} ${h === 1 ? "hour" : "hours"}` : `in ${Math.round(ms / 60_000)} min`
}

/** The watch and its pieces, polled while a check or an approval runs. */
export function useBrandWatch(brandId: string) {
  const q = useApi(brandWatchKey(brandId), () => getBrandWatch(brandId), {
    revalidateOnFocus: true,
  })
  const busy = !!q.data && (q.data.watch?.checking || q.data.pieces.some((p) => p.status === "approving"))
  const revalidate = q.revalidate
  useEffect(() => {
    if (!busy) return
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void revalidate()
    }, 2000)
    return () => window.clearInterval(t)
  }, [busy, revalidate])
  return q
}

/** What Yard's Approve does for this brand (a suggestion; live on claim with "Go live when they claim"). */
function approveMeaning(b: AdminWatchDto["brand"]) {
  if (b.claimStatus === "unclaimed") return b.goLiveOnClaim ? `Approve adds it to what goes live when ${b.name} is claimed.` : `Approve saves it as a suggestion for ${b.name}'s owner.`
  return `Approve sends it to ${b.name} as a Suggestion from Yard to accept.`
}

function approvedMeaning(b: AdminWatchDto["brand"]) {
  if (b.claimStatus === "unclaimed") return b.goLiveOnClaim ? `It goes live when ${b.name} is claimed.` : `Saved as a suggestion for ${b.name}'s owner.`
  return `Sent to ${b.name} as a Suggestion from Yard.`
}

/* ---------- import page: the whole panel ---------- */

export function WatchPanel({ brandId, importId, importHost, canStart = true }: { brandId: string; importId?: string; importHost?: string | null; canStart?: boolean }) {
  const id = useId()
  const q = useBrandWatch(brandId)
  const [busy, setBusy] = useState<null | "toggle" | "check">(null)
  const [error, setError] = useState<string | null>(null)
  const data = q.data
  if (!data) return null
  const w = data.watch
  const on = !!w?.enabled
  const site = w ? hostOf(w.sourceUrl) : (importHost ?? "their website")

  async function toggle(next: boolean) {
    setBusy("toggle")
    setError(null)
    try {
      q.mutate(
        await setBrandWatch({
          brandId,
          enabled: next,
          ...(next && importId ? { importId } : {}),
        }),
      )
      toast.success(next ? `Watching ${site}` : `Stopped watching ${site}`, {
        description: next ? `Yard checks it every ${data!.watch?.everyHours ?? 6} hours. New pieces wait here and in ${data!.brand.name}'s Studio.` : "Pieces already waiting stay here.",
      })
    } catch (e) {
      setError(errorMessage(e, "That didn't change. Try again."))
    } finally {
      setBusy(null)
    }
  }
  async function check(resume?: boolean) {
    setBusy("check")
    setError(null)
    try {
      q.mutate(await checkBrandWatch(brandId, resume))
    } catch (e) {
      setError(errorMessage(e, "The check couldn't start. Try again."))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-labelledby={`${id}-h`} className="grid max-w-3xl gap-4">
      <h2 id={`${id}-h`} className="sr-only">
        Watching {site}
      </h2>
      {!w && !canStart ? (
        <p className="text-[12.5px] text-ink-3">Scan {data.brand.name}&apos;s website first. Then Yard can keep watching it for new pieces.</p>
      ) : (
        <div className={cn("grid gap-3 p-3 sm:p-4", insetClass)}>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor={`${id}-watch`} className="grid min-w-0 gap-0.5 text-[13px] leading-snug font-normal text-ink-2">
              <span className="text-ink">Keep watching {site} for new pieces</span>
              <span className="text-[11.5px] text-ink-3">
                Every {w?.everyHours ?? 6} hours Yard looks for pieces it hasn&apos;t seen. They wait here and in {data.brand.name}&apos;s Studio; whoever approves first adds them. Price changes are only flagged.
              </span>
            </Label>
            <Switch id={`${id}-watch`} checked={on} disabled={!!busy} onCheckedChange={(v) => void toggle(v)} />
          </div>
          {w && on ? <WatchStatus w={w} seen={data.seen} busy={busy === "check"} onCheck={() => void check()} onResume={() => void check(true)} /> : null}
          {error ? (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          ) : null}
        </div>
      )}
      <PiecesList data={data} brandId={brandId} onChanged={(next) => q.mutate(next)} />
      <ChangesList data={data} onChanged={(next) => q.mutate(next)} />
    </section>
  )
}

function WatchStatus({ w, seen, busy, onCheck, onResume }: { w: NonNullable<AdminWatchDto["watch"]>; seen: number; busy: boolean; onCheck: () => void; onResume: () => void }) {
  const paused = w.status === "paused"
  return (
    <div className="grid gap-2 border-t border-white/[0.06] pt-3" aria-live="polite">
      {paused ? (
        <p role="alert" className="flex items-start gap-2 text-[12.5px] text-ink">
          <WarningIcon className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
          <span>{w.pausedNote ?? "Watching paused."}</span>
        </p>
      ) : null}
      <p className="text-[12px] text-ink-3">
        {IMPORT_PLATFORM_LABELS[w.platform]} · {w.checking ? "Checking now…" : w.lastScanAt ? `Last checked ${relativeTime(w.lastScanAt).toLowerCase()}` : "Not checked yet"}
        {!w.checking && w.lastRun ? ` · ${w.lastRun.products} on the site, ${w.lastRun.new} new, ${w.lastRun.requests} requests` : ""}
        {!w.checking && !paused && w.nextScanAt ? ` · next ${inFuture(w.nextScanAt)}` : ""} · {seen} seen
      </p>
      {!paused && w.lastError ? (
        <p className="text-[12px] text-danger">
          Last check failed ({w.failures} in a row): {w.lastError} Trying again later.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {paused ? (
          <Button type="button" variant="secondary" size="sm" className="h-10 sm:h-8" loading={busy} onClick={onResume}>
            <ArrowsClockwiseIcon aria-hidden /> Resume and check now
          </Button>
        ) : (
          <Button type="button" variant="secondary" size="sm" className="h-10 sm:h-8" loading={busy || w.checking} disabled={w.checking} onClick={onCheck}>
            <ArrowsClockwiseIcon aria-hidden /> {w.checking ? "Checking…" : "Check now"}
          </Button>
        )}
      </div>
    </div>
  )
}

/* ---------- New from their website ---------- */

function PiecesList({ data, brandId, onChanged, compact }: { data: AdminWatchDto; brandId: string; onChanged: (d: AdminWatchDto) => void; compact?: boolean }) {
  const id = useId()
  const [busy, setBusy] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const waiting = data.pieces.filter((p) => p.status === "waiting")
  if (!data.pieces.length) {
    if (compact) return null
    return data.watch?.enabled ? <p className="text-[12.5px] text-ink-3">Nothing new from their website yet.</p> : null
  }

  async function act(p: SitePieceDto, action: "approve" | "skip") {
    setBusy(`${p.id}:${action}`)
    setErrors((e) => ({ ...e, [p.id]: "" }))
    try {
      onChanged(await actOnWebsitePiece(p.id, action))
      if (action === "approve")
        toast.success(`${p.title} approved`, {
          description: approvedMeaning(data.brand),
        })
      else toast(`${p.title} skipped`, { description: "It won't come back." })
    } catch (e) {
      setErrors((x) => ({ ...x, [p.id]: errorMessage(e) }))
      toast.error(action === "approve" ? `${p.title} wasn't approved` : `${p.title} wasn't skipped`, { description: errorMessage(e) })
      void getBrandWatch(brandId).then(onChanged, () => {})
    } finally {
      setBusy(null)
    }
  }
  async function approveAll() {
    setBusy("all")
    try {
      const r = await approveAllWebsitePieces(brandId)
      onChanged(r)
      toast.success(r.taken === 1 ? "Approving 1 piece" : `Approving ${r.taken} pieces`, {
        description: "Photos are being copied into Yard. This list updates as each one is added.",
      })
    } catch (e) {
      toast.error("Approve all didn't start", { description: errorMessage(e) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-labelledby={`${id}-new`} className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${id}-new`} className={cn("text-ink", compact ? "font-label text-[13px]" : "text-[15px] font-medium")}>
          New from their website <span className="text-ink-3 tabular">({waiting.length})</span>
        </h3>
        {waiting.length > 1 ? (
          <Button type="button" variant="secondary" size="sm" className="h-10 sm:h-8" loading={busy === "all"} disabled={!!busy} onClick={() => void approveAll()}>
            <CheckIcon aria-hidden /> Approve all
          </Button>
        ) : null}
      </div>
      <p className="text-[11.5px] text-ink-3">{approveMeaning(data.brand)} Photos are copied into Yard when it&apos;s approved. If the brand adds or skips one first in Studio, it leaves this list.</p>
      <ul className="grid gap-1.5">
        {data.pieces.map((p) => (
          <li key={p.id} className={cn("grid gap-2 px-3 py-2.5", insetClass)}>
            <div className="flex items-start gap-3">
              {p.images[0] ? (
                // eslint-disable-next-line @next/next/no-img-element -- the site's own photo, for recognition only; Yard copies it on approval
                <img src={p.images[0]} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-12 shrink-0 rounded border border-white/10 object-cover" />
              ) : (
                <span className="size-12 shrink-0 rounded border border-dashed border-white/10" aria-hidden />
              )}
              <div className="grid min-w-0 flex-1 gap-0.5">
                <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer" className="truncate text-[13px] text-ink hover:text-violet">
                  {p.title}
                  <span className="sr-only"> (opens their website)</span>
                </a>
                <p className="text-[11.5px] text-ink-3">
                  {money(p.yardPriceMinor ?? p.priceMinor, p.yardPriceMinor != null ? data.brand.currency : p.currency)}
                  {p.sizes.length ? ` · ${p.sizes.join(", ")}` : ""}
                  {p.availability === "out_of_stock" ? " · sold out on the site" : ""} · found {relativeTime(p.firstSeenAt).toLowerCase()}
                </p>
              </div>
              {p.status === "approving" ? (
                <StatusBadge tone="info">
                  <CircleNotchIcon className="size-3 animate-spin motion-reduce:animate-none" aria-hidden /> {p.taken === "brand" ? "Brand adding" : "Adding"}
                </StatusBadge>
              ) : null}
            </div>
            {p.status === "waiting" ? (
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" size="sm" className="h-10 flex-1 sm:h-8 sm:flex-none" loading={busy === `${p.id}:approve`} disabled={!!busy} onClick={() => void act(p, "approve")}>
                  <CheckIcon aria-hidden /> Approve
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-10 flex-1 sm:h-8 sm:flex-none" loading={busy === `${p.id}:skip`} disabled={!!busy} onClick={() => void act(p, "skip")}>
                  <XIcon aria-hidden /> Skip
                </Button>
              </div>
            ) : null}
            {errors[p.id] || p.error ? (
              <p role="alert" className="text-[11.5px] text-danger">
                {errors[p.id] || p.error}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ---------- Changes on their site ---------- */

function ChangesList({ data, onChanged }: { data: AdminWatchDto; onChanged: (d: AdminWatchDto) => void }) {
  const id = useId()
  const [busy, setBusy] = useState<string | null>(null)
  if (!data.changes.length) return null
  async function dismiss(c: SiteChangeDto) {
    setBusy(c.id)
    try {
      onChanged(await actOnWebsitePiece(c.id, "dismiss_change"))
    } catch (e) {
      toast.error("That didn't go through", { description: errorMessage(e) })
    } finally {
      setBusy(null)
    }
  }
  return (
    <section aria-labelledby={`${id}-ch`} className="grid gap-2">
      <h3 id={`${id}-ch`} className="text-[15px] font-medium text-ink">
        Changes on their site <span className="text-ink-3 tabular">({data.changes.length})</span>
      </h3>
      <p className="text-[11.5px] text-ink-3">
        Pieces already in Yard whose price or stock changed on {data.brand.name}
        &apos;s site. Yard never changes the product; tell the brand, or suggest a change.
      </p>
      <ul className="grid gap-1.5">
        {data.changes.map((c) => (
          <li key={c.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5", insetClass)}>
            <div className="grid min-w-0 flex-1 gap-0.5">
              <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer" className="truncate text-[13px] text-ink hover:text-violet">
                {c.title}
              </a>
              <p className="text-[11.5px] text-ink-2">
                {c.price ? `Price ${money(c.price.from, c.price.currency)} → ${money(c.price.to, c.price.currency)}` : ""}
                {c.price && c.soldOut ? " · " : ""}
                {c.soldOut ? "Sold out on their site" : ""}
                <span className="text-ink-3"> · seen {relativeTime(c.at).toLowerCase()}</span>
              </p>
            </div>
            <div className="flex gap-2">
              {c.productId ? (
                <Button asChild variant="ghost" size="sm" className="h-10 sm:h-8">
                  <Link href={`/admin/products/suggestions/new?product=${encodeURIComponent(c.productId)}`}>Suggest a change</Link>
                </Button>
              ) : c.proposalId ? (
                <Button asChild variant="ghost" size="sm" className="h-10 sm:h-8">
                  <Link href={`/admin/products/suggestions?proposal=${encodeURIComponent(c.proposalId)}`}>Open suggestion</Link>
                </Button>
              ) : null}
              <Button type="button" variant="secondary" size="sm" className="h-10 sm:h-8" loading={busy === c.id} disabled={!!busy} onClick={() => void dismiss(c)}>
                Dismiss
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ---------- the brand tray ---------- */

/** Brand tray › Products: "New from their website (N)" with Approve / Skip / Approve all, and the watch in one line. */
export function WebsitePiecesTray({ brandId }: { brandId: string }) {
  const q = useBrandWatch(brandId)
  const data = q.data
  if (!data || (!data.pieces.length && !data.watch?.enabled && !data.changes.length)) return null
  const w = data.watch
  return (
    <div className="grid gap-2">
      <PiecesList data={data} brandId={brandId} onChanged={(next) => q.mutate(next)} compact />
      <p className="text-[11.5px] text-ink-3">
        {w?.enabled ? (w.status === "paused" ? `Watching ${hostOf(w.sourceUrl)} is paused.` : `Watching ${hostOf(w.sourceUrl)}${w.lastScanAt ? `, checked ${relativeTime(w.lastScanAt).toLowerCase()}` : ""}.`) : "Not watching their website."}
        {data.changes.length ? ` ${data.changes.length} ${data.changes.length === 1 ? "change" : "changes"} on their site.` : ""}{" "}
        <Link href={`/admin/brands/${encodeURIComponent(brandId)}/import`} className="text-violet underline-offset-4 hover:underline">
          Manage
        </Link>
      </p>
    </div>
  )
}
