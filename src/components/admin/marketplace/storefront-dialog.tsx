"use client"

import { useCallback, useState } from "react"
import { toast } from "sonner"
import { EyeSlashIcon, RocketLaunchIcon, WarningIcon, XCircleIcon } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { useAdminSession } from "@/components/admin/trust/shared"
import { adminStorefrontKey, getAdminStorefront, publishAdminStorefront, unpublishAdminStorefront, type AdminStorefrontPreviewDto, type AdminStorefrontStateDto } from "@/lib/api/admin-storefront"
import { errorMessage } from "@/lib/api/errors"
import { revalidatePrefix, useApi } from "@/lib/api/use-api"
import { payoutStatusLabel } from "@/lib/admin-storefront"
import { cn } from "@/lib/utils"
import { DetailSection, insetClass } from "./detail-sheet"
import { formatDate } from "./format"

/**
 * Admin › Brands › Publish / Unpublish storefront, for any brand that isn't closed (brands.restrict;
 * the server also asks brands.founding for an unclaimed founding brand). The owner asked for a modal
 * confirmation: it says what goes live (the number of live products) and anything that holds the
 * shop back (no products; no payout account, so Buy stays off for a founding brand, or the shop takes orders but Yard can't pay an ordinary brand yet), and
 * refuses with the reason when the brand can't be published (suspended, restricted, in review).
 */

export type StorefrontTarget = { brandId: string; name: string }
export type StorefrontAction = "publish" | "unpublish"

/** One dialog per view: `ask(target, action)` opens it. */
export function useStorefrontAction() {
  const [state, setState] = useState<{ target: StorefrontTarget; action: StorefrontAction; n: number; open: boolean } | null>(null)
  const ask = useCallback((target: StorefrontTarget, action: StorefrontAction) => setState((s) => ({ target, action, n: (s?.n ?? 0) + 1, open: true })), [])
  const dialog = state ? (
    <StorefrontDialog key={state.n} target={state.target} action={state.action} open={state.open} onOpenChange={(open) => setState((s) => (s ? { ...s, open } : s))} />
  ) : null
  return { ask, dialog }
}

function StorefrontDialog({ target, action, open, onOpenChange }: { target: StorefrontTarget; action: StorefrontAction; open: boolean; onOpenChange: (o: boolean) => void }) {
  const q = useApi(open ? adminStorefrontKey(target.brandId) : null, () => getAdminStorefront(target.brandId), { revalidateOnFocus: false, keepPrevious: false })
  const p: AdminStorefrontPreviewDto | undefined = q.data
  const s = p?.storefront
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const name = p?.brand.name || target.name
  const publish = action === "publish"
  const noop = s ? (publish ? s.publish.noop : s.unpublish.noop) : false
  const blockers = s ? (publish ? s.publish.blockers : s.unpublish.blocker ? [s.unpublish.blocker] : []) : []
  const allowed = !!s && (publish ? s.publish.allowed : s.unpublish.allowed)
  // A claimed founding brand that isn't live yet: the same publish, named for what the owner wants.
  const makeLive = publish && !!s?.claimedNotLive

  async function confirm() {
    if (pending || !allowed) return
    setPending(true)
    setFailure(null)
    try {
      if (publish) {
        const r = await publishAdminStorefront(target.brandId)
        q.mutate(r.preview)
        toast.success(r.created ? (makeLive ? `${name} is live` : `${name}'s shop is live`) : `${name}'s shop was already live`, {
          description: r.created ? (r.emailed ? `We emailed ${r.emailed === 1 ? "the owner" : `${r.emailed} owners and admins`} “You're live”. Recorded in the audit log.` : "Recorded in the audit log.") : "Nothing changed.",
        })
      } else {
        const r = await unpublishAdminStorefront(target.brandId)
        q.mutate(r.preview)
        toast.success(r.changed ? `${name}'s shop is unpublished` : `${name}'s shop wasn't live`, { description: r.changed ? "Shoppers can't find its storefront or products until it's published again. Recorded in the audit log." : "Nothing changed." })
      }
      revalidatePrefix("admin:")
      onOpenChange(false)
    } catch (cause) {
      setFailure(errorMessage(cause, publish ? "The storefront couldn't be published. Try again." : "The storefront couldn't be unpublished. Try again."))
      void q.revalidate()
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[500px]" data-testid="storefront-dialog">
        <DialogHeader>
          <DialogTitle className="font-label pr-6 text-base">{makeLive ? `Make ${name} live?` : publish ? `Publish ${name}'s storefront?` : `Unpublish ${name}'s storefront?`}</DialogTitle>
          <DialogDescription className="text-ink-2">
            {!s
              ? q.error
                ? errorMessage(q.error)
                : `Checking ${target.name}'s storefront…`
              : noop
                ? publish
                  ? `${name}'s shop is already live. Nothing to publish.`
                  : `${name}'s shop isn't live, so there's nothing to unpublish.`
                : makeLive
                  ? `${name} was claimed by its owner but isn't public yet. This publishes its storefront${s.hasVersion ? "" : " draft"}, launches the brand and puts its ${s.liveProducts} published ${s.liveProducts === 1 ? "product" : "products"} on the marketplace.`
                  : publish
                  ? s.hasVersion
                    ? `Its last published storefront goes back on the marketplace with its live products.`
                    : `Its storefront draft goes live, the same publish as Studio's, recorded under your name.`
                  : "Its storefront, products and listing leave the marketplace until it's published again. The brand isn't restricted: its team keeps working in Studio."}
          </DialogDescription>
        </DialogHeader>

        {s ? <StorefrontFacts s={s} /> : <div aria-hidden className="skeleton h-24 rounded-md" />}

        {s && publish && !noop && s.publish.warnings.length ? (
          <ul className="grid gap-1.5" aria-label="Before it goes live">
            {s.publish.warnings.map((w) => (
              <li key={w} className="flex items-start gap-1.5 text-[12.5px] text-acid">
                <WarningIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>{w}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {blockers.length && !noop ? (
          <ul className="grid gap-1.5 rounded-md border border-danger/30 bg-danger/[0.06] px-3 py-2.5" aria-label="Why it can't be done">
            {blockers.map((b) => (
              <li key={b} className="flex items-start gap-1.5 text-[12.5px] text-ink">
                <XCircleIcon className="mt-0.5 size-3.5 shrink-0 text-danger" aria-hidden />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {s && publish && allowed ? <p className="text-[11.5px] text-ink-3">{`We'll email ${name}'s owners and admins “You're live 🎉” if they haven't had it yet. Recorded in the audit log.`}</p> : null}
        {failure ? (
          <p role="alert" className="text-[12.5px] text-danger">
            {failure}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="secondary" disabled={pending} onClick={() => onOpenChange(false)}>
            {noop || !allowed ? "Close" : "Cancel"}
          </Button>
          {noop ? null : (
            <Button type="button" variant={publish ? "primary" : "destructive-solid"} loading={pending} disabled={!allowed || pending} onClick={() => void confirm()}>
              {publish ? <RocketLaunchIcon /> : <EyeSlashIcon />} {makeLive ? "Make live" : publish ? "Publish storefront" : "Unpublish storefront"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function liveLabel(s: AdminStorefrontStateDto) {
  if (s.closed) return { label: "Closed", tone: "danger" as const }
  if (s.live) return { label: "Live", tone: "success" as const }
  if (s.claimedNotLive) return { label: "Claimed, not live yet", tone: "attention" as const }
  if (s.unpublished) return { label: "Unpublished by Yard", tone: "attention" as const }
  return { label: "Not published", tone: "muted" as const }
}

const payoutTone = { none: "attention", pending: "muted", verified: "success" } as const

/** Storefront and payout account facts, shared by the dialog and the brand sheet. */
function StorefrontFacts({ s }: { s: AdminStorefrontStateDto }) {
  const state = liveLabel(s)
  return (
    <dl className={cn("grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 px-3 py-2.5 text-[12.5px]", insetClass)}>
      <dt className="text-ink-3">Storefront</dt>
      <dd>
        <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
      </dd>
      <dt className="text-ink-3">Live products</dt>
      <dd className="text-ink tabular">{s.liveProducts}</dd>
      <dt className="text-ink-3">Payout account</dt>
      <dd className="grid gap-0.5">
        <span>
          <StatusBadge tone={payoutTone[s.payout?.status ?? "none"]}>{payoutStatusLabel[s.payout?.status ?? "none"]}</StatusBadge>
        </span>
        {s.payout ? (
          <span className="text-ink-2">
            {s.payout.bankName ? (
              <>
                {s.payout.bankName} <span className="tabular">•••• {s.payout.last4}</span>, {s.payout.accountName}.{" "}
              </>
            ) : null}
            Added or changed {formatDate(s.payout.changedAt)}
          </span>
        ) : null}
      </dd>
    </dl>
  )
}

/**
 * The brand sheet's Storefront section (Admin › Brands, the All brands tab's sheet): live or not,
 * live products, the payout account's status, and Publish / Unpublish (the same dialog as the row menu).
 */
export function StorefrontSection({ brandId, brandName, onAsk }: { brandId: string; brandName: string; onAsk: (t: StorefrontTarget, action: StorefrontAction) => void }) {
  const session = useAdminSession()
  const can = session.can("brands.restrict")
  const q = useApi(can ? adminStorefrontKey(brandId) : null, () => getAdminStorefront(brandId), { revalidateOnFocus: true })
  if (!can) return null
  const s = q.data?.storefront
  return (
    <DetailSection title="Storefront and payouts">
      {s ? (
        <>
          <StorefrontFacts s={s} />
          {s.closed ? null : (
            <div className="flex flex-wrap gap-2">
              {s.live ? (
                <Button type="button" size="sm" variant="secondary" className="h-10 sm:h-8" onClick={() => onAsk({ brandId, name: brandName }, "unpublish")}>
                  <EyeSlashIcon /> Unpublish storefront
                </Button>
              ) : (
                <Button type="button" size="sm" variant="primary" className="h-10 sm:h-8" onClick={() => onAsk({ brandId, name: brandName }, "publish")}>
                  <RocketLaunchIcon /> {s.claimedNotLive ? "Make live" : "Publish storefront"}
                </Button>
              )}
            </div>
          )}
        </>
      ) : q.error ? (
        <p role="alert" className="text-[12px] text-danger">
          {errorMessage(q.error, "Couldn't load the storefront.")}
        </p>
      ) : (
        <div aria-hidden className="skeleton h-20 rounded-md" />
      )}
    </DetailSection>
  )
}
