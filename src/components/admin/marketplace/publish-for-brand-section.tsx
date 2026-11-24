"use client"

import { useEffect, useId, useState } from "react"
import { toast } from "sonner"
import { CheckCircleIcon, CircleDashedIcon, RocketLaunchIcon, WarningIcon } from "@phosphor-icons/react"
import { ActionErrorNote, actionError, type ActionError } from "@/components/admin/finance/reauth"
import { useAdminSession } from "@/components/admin/trust/shared"
import { Button } from "@/components/ui/button"
import { getPublishForBrand, publishForBrand, publishForBrandKey, type PublishForBrandDto } from "@/lib/api/founding"
import { useApi } from "@/lib/api/use-api"
import { publishForBrandLabel } from "@/lib/publish-for-brand"
import { cn } from "@/lib/utils"
import { DetailSection, insetClass } from "./detail-sheet"

/**
 * "Publish storefront for {brand}" in a brand's tray (Admin › Brands and the founding tray,
 * brands.restrict). Shown only while the brand's storefront has never been published. The button
 * opens an inline confirm in the tray (like the claim link's, never a dialog) with the checklist
 * of what goes live: logo, banner, intro and live products, warning "Shop will show as empty" at
 * 0 but still allowing it. The server publishes the brand's own draft through the brand's own
 * publish, records the admin as publisher and emails the owners "You're live 🎉" once.
 */
export function PublishForBrandSection({ brandId, brandName, onPublished }: { brandId: string; brandName: string; onPublished?: (r: PublishForBrandDto) => void }) {
  const session = useAdminSession()
  if (!session.can("brands.restrict")) return null
  return <Section key={brandId} brandId={brandId} brandName={brandName} onPublished={onPublished} />
}

function Section({ brandId, brandName, onPublished }: { brandId: string; brandName: string; onPublished?: (r: PublishForBrandDto) => void }) {
  const id = useId()
  const q = useApi(publishForBrandKey(brandId), () => getPublishForBrand(brandId), { revalidateOnFocus: true })
  const p = q.data
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<ActionError | null>(null)

  useEffect(() => {
    if (confirming) document.getElementById(`${id}-confirm`)?.focus()
  }, [confirming, id])

  // Nothing to do once it's live (or before we know): the tray's facts say "Published".
  if (!p || p.published) return null
  const name = p.brand.name || brandName
  const unclaimed = p.brand.founding && p.brand.claimStatus === "unclaimed"

  async function publish() {
    if (busy) return
    setBusy(true)
    setFailure(null)
    try {
      const r = await publishForBrand(brandId)
      q.mutate(r.preview)
      setConfirming(false)
      if (r.created) {
        toast.success(`${name}'s shop is live`, {
          description: r.emailed ? `We emailed ${r.emailed === 1 ? "the owner" : `${r.emailed} owners and admins`} “You're live”.` : unclaimed ? "They'll hear it's live when they claim it." : "No owner or admin with an email to tell yet.",
        })
      } else toast.success(`${name}'s shop was already live`, { description: "Nothing changed." })
      onPublished?.(r)
    } catch (cause) {
      setFailure(actionError(cause, "The storefront couldn't be published. Try again."))
      void q.revalidate()
    } finally {
      setBusy(false)
    }
  }

  return (
    <DetailSection title="Storefront" aside={<span className="text-[11px] text-ink-3">Not published yet</span>}>
      <p className="text-[12px] text-ink-3">
        {unclaimed
          ? `${name} is hidden from shoppers until its storefront is published. Publish it now, or let it go live when they claim.`
          : `${name}'s storefront was never published, so shoppers can't find it. Publish it for them: the same publish as Studio's, recorded under your name.`}
      </p>
      {confirming ? (
        <div className={cn("grid gap-3 px-3 py-3", insetClass)} role="group" aria-labelledby={`${id}-title`}>
          <p id={`${id}-title`} className="text-[13px] text-ink">
            Put {name} live with what&apos;s in its storefront draft?
          </p>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 sm:flex sm:flex-wrap sm:gap-x-5" aria-label="What goes live">
            {p.checklist.items.map((c) => (
              <li key={c.key} className="flex min-w-0 items-center gap-1.5 text-[12.5px] sm:shrink-0">
                {c.done ? <CheckCircleIcon weight="fill" className="size-4 shrink-0 text-violet" aria-hidden /> : <CircleDashedIcon className="size-4 shrink-0 text-ink-3" aria-hidden />}
                <span className={cn("min-w-0 truncate sm:overflow-visible", c.done ? "text-ink-2" : "text-ink-3")}>
                  {c.label}
                  {c.value !== undefined ? <span className="tabular"> {c.value}</span> : null}
                  <span className="sr-only">{c.done ? ", done" : ", missing"}</span>
                </span>
              </li>
            ))}
          </ul>
          {p.checklist.warning ? (
            <p className="flex items-start gap-1.5 text-[12px] text-acid">
              <WarningIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>{p.checklist.warning}. You can still publish; products show up as they go live.</span>
            </p>
          ) : null}
          <p className="text-[11.5px] text-ink-3">
            {unclaimed ? "Shoppers can find it at once, but it isn't for sale until the owner claims it." : `We'll email ${name}'s owners and admins “You're live 🎉”${p.payoutAccount ? "." : ", with a nudge to add their payout account."}`}
          </p>
          <ActionErrorNote error={failure} onReload={() => window.location.reload()} />
          <div className="flex flex-wrap items-center justify-end gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">
            <Button type="button" size="sm" variant="secondary" className="h-10 sm:h-8" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button id={`${id}-confirm`} type="button" size="sm" variant="primary" className="h-10 sm:h-8" loading={busy} disabled={busy} onClick={() => void publish()}>
              Confirm and publish
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-1.5">
          <Button
            type="button"
            size="sm"
            // An unclaimed brand set to go live on claim usually waits for its owner: the quieter button.
            variant={unclaimed && p.goLiveOnClaim ? "secondary" : "primary"}
            className="h-10 w-full sm:h-9 sm:w-fit"
            disabled={!!p.blocked} aria-describedby={p.blocked ? `${id}-blocked` : undefined} onClick={() => setConfirming(true)}>
            <RocketLaunchIcon /> {publishForBrandLabel(name)}
          </Button>
          {p.blocked ? (
            <p id={`${id}-blocked`} className="text-[11.5px] text-ink-3">
              {p.blocked}
            </p>
          ) : null}
          <ActionErrorNote error={failure} onReload={() => window.location.reload()} />
        </div>
      )}
    </DetailSection>
  )
}
