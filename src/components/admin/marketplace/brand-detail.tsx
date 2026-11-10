"use client"

import { useId, useState } from "react"
import { CheckCircleIcon, CircleDashedIcon, ClockIcon, XCircleIcon } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { useAsyncAction } from "@/hooks/use-async-action"
import { useNow } from "@/hooks/use-now"
import { STUDIO_BRAND_ID } from "@/lib/data/brands"
import type { AuditEntry, BrandApplication } from "@/lib/data/admin"
import { useAdmin } from "@/lib/stores/admin"
import { cn } from "@/lib/utils"
import { Initials } from "./bits"
import { allowedBrandActions, brandActions, onServer, useBrandStatusBlock, type BrandActionKey } from "./brand-actions"
import { ServerActivity, TrustActionBar } from "@/components/admin/trust/shared"
import { verificationChecklist, type CheckState } from "./derive"
import { ActivityList, DetailSection, DetailSheet, Facts, LinkRow, insetClass } from "./detail-sheet"
import { categoryName, countryName, daysSince, formatDate, plural, relDays } from "./format"
import { brandStatusMeta, kycMeta, riskMeta } from "./meta"
import { useLast } from "./use-last"

const NOTE_ACTION = "Added internal note"

const checkIcon: Record<CheckState, { icon: React.ComponentType<{ className?: string }>; className: string; label: string }> = {
  done: { icon: CheckCircleIcon, className: "text-violet", label: "Done" },
  review: { icon: ClockIcon, className: "text-ink-2", label: "In review" },
  missing: { icon: CircleDashedIcon, className: "text-ink-3", label: "Missing" },
  failed: { icon: XCircleIcon, className: "text-danger", label: "Failed" },
}

/** Whether an audit entry is about this brand: by record id when the entry carries one, else by the name it was logged under. */
function isAbout(e: AuditEntry, a: BrandApplication) {
  if (e.subjectId) return e.subjectId === a.id
  return e.target === a.brandName || e.target.startsWith(`${a.brandName},`) || e.target.startsWith(`${a.brandName} (`) || e.target.endsWith(`(${a.brandName})`)
}

export function BrandDetail({ id, open, onOpenChange, onDecide }: { id: string | null; open: boolean; onOpenChange: (o: boolean) => void; onDecide: (key: BrandActionKey, a: BrandApplication) => void }) {
  // Keep the last record while the sheet animates out.
  // Relative days count from the same today as every other Control Center page.
  const now = useNow(60_000)
  const shown = useLast(id)
  const app = useAdmin((s) => s.applications.find((a) => a.id === shown))
  const audit = useAdmin((s) => s.audit)
  const moderation = useAdmin((s) => s.moderation)
  const blockFor = useBrandStatusBlock()

  if (!app) return null

  const entries = audit.filter((e) => isAbout(e, app))
  const notes = entries.filter((e) => e.action === NOTE_ACTION)
  const checklist = verificationChecklist(app)
  const done = checklist.filter((c) => c.state === "done").length
  const cases = moderation.filter((m) => m.brandName === app.brandName)
  const openCases = cases.filter((m) => m.status === "open" || m.status === "escalated").length
  const status = brandStatusMeta[app.status]
  const age = daysSince(app.submittedAt, now)

  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      title={app.brandName}
      description={`@${app.handle}, ${countryName(app.country)}`}
      lead={<Initials name={app.brandName} size="lg" />}
      badges={
        <>
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          <StatusBadge tone={kycMeta[app.kyc].tone}>KYC {kycMeta[app.kyc].label.toLowerCase()}</StatusBadge>
          <StatusBadge tone={riskMeta[app.risk].tone}>{riskMeta[app.risk].label} risk</StatusBadge>
          {app.brandId === STUDIO_BRAND_ID ? <StatusBadge tone="muted">Studio brand</StatusBadge> : null}
        </>
      }
      actions={
        <TrustActionBar
          note={`${app.status === "pending_review" ? `${age === 0 ? "Submitted today. " : `In the queue for ${plural(age, "day")}. `}` : ""}${onServer(app) ? "Enforced on Yard's server." : "Sample application in this browser only."} Every decision needs a reason and is recorded in the audit log.`}
          actions={allowedBrandActions(app).map((key) => ({ key, label: brandActions[key].label, icon: brandActions[key].icon, variant: brandActions[key].button, disabledReason: blockFor(app), onSelect: () => onDecide(key, app) }))}
        />
      }
    >
      <Facts
        items={[
          { label: "Category", value: categoryName(app.category) },
          { label: "Products", value: <span className="tabular">{app.products}</span> },
          { label: "Submitted", value: <time dateTime={app.submittedAt}>{formatDate(app.submittedAt)}</time> },
          { label: "Open cases", value: openCases ? <span className="text-acid tabular">{openCases}</span> : <span className="text-ink-2">None</span> },
        ]}
      />

      <DetailSection title="Verification" aside={<span className="text-[11px] text-ink-3 tabular">{done} of {checklist.length} complete</span>}>
        <ul className={cn("divide-y divide-white/[0.07]", insetClass)}>
          {checklist.map((c) => {
            const meta = checkIcon[c.state]
            return (
              <li key={c.key} className="flex items-start gap-2.5 px-3 py-2.5">
                <meta.icon className={cn("mt-0.5 size-4 shrink-0", meta.className)} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] text-ink">{c.label}</span>
                  <span className="block text-[11.5px] text-ink-3">{c.detail}</span>
                </span>
                <span className={cn("shrink-0 text-[11px]", c.state === "failed" ? "text-danger" : c.state === "done" ? "text-ink-2" : "text-ink-3")}>{meta.label}</span>
              </li>
            )
          })}
        </ul>
      </DetailSection>

      <DetailSection title="Notes">
        <div className={insetClass}>
          <div className="px-3 py-2.5">
            <p className="text-[11px] text-ink-3">Review summary</p>
            <p className="mt-0.5 text-[13px] text-ink-2">{app.notes}</p>
          </div>
          {notes.length ? (
            <ul className="divide-y divide-white/[0.07] border-t border-white/[0.07]">
              {notes.map((x) => (
                <li key={x.id} className="px-3 py-2.5">
                  <p className="text-[13px] text-ink">{x.reason}</p>
                  <p className="mt-0.5 text-[11px] text-ink-3">{x.actor}, {relDays(x.at, now).toLowerCase()}</p>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <NoteForm key={app.id} brandName={app.brandName} />
      </DetailSection>

      <DetailSection title="Activity">
        {app.brandId ? (
          <ServerActivity subjectIds={[app.brandId]} legacy={entries.filter((e) => e.action !== NOTE_ACTION)} extra={[{ at: app.submittedAt, label: "Application submitted", detail: `${app.products} products, ${categoryName(app.category).toLowerCase()}` }]} />
        ) : (
          <ActivityList entries={entries.filter((e) => e.action !== NOTE_ACTION)} extra={[{ at: app.submittedAt, label: "Application submitted", detail: `${app.products} products, ${categoryName(app.category).toLowerCase()}` }]} />
        )}
      </DetailSection>

      <DetailSection title="Links">
        <ul className="grid gap-1.5">
          {app.brandId ? (
            <li>
              <LinkRow href={`/brands/${app.handle}`} label="View storefront" hint={`/brands/${app.handle}`} />
            </li>
          ) : (
            <li className="rounded-[10px] border border-dashed border-white/10 px-3 py-2.5 text-[12px] text-ink-3">{app.status === "pending_review" ? "No storefront yet. It appears once the brand is approved and publishes." : "This brand has no public storefront."}</li>
          )}
          <li>
            <LinkRow
              href={cases.length ? `/admin/products?case=${(cases.find((m) => m.status === "open" || m.status === "escalated") ?? cases[0]).id}` : "/admin/products"}
              label={cases.length ? "Moderation cases" : "Moderation queue"}
              hint={cases.length ? `${plural(cases.length, "case")} for this brand, ${openCases} open` : "No cases for this brand"}
            />
          </li>
          {app.brandId ? (
            <li>
              <LinkRow href={`/admin/finance?tab=payouts&focus=po_${app.handle}`} label="Payouts and ledger" hint="This brand's payout in Finance" />
            </li>
          ) : null}
        </ul>
      </DetailSection>
    </DetailSheet>
  )
}

/** An internal note on the brand, written to the audit log. The note appearing in the list above is the confirmation. */
function NoteForm({ brandName }: { brandName: string }) {
  const id = useId()
  const log = useAdmin((s) => s.log)
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const save = useAsyncAction((note: string) => {
    log(NOTE_ACTION, brandName, note)
    setText("")
  })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const v = text.trim()
    if (v.length < 3) {
      setError("Write the note first: at least 3 characters.")
      document.getElementById(`${id}-note`)?.focus()
      return
    }
    setError(null)
    void save.run(v)
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-1.5">
      <Label htmlFor={`${id}-note`} className="text-[12px] text-ink-2">
        Internal note
      </Label>
      <Textarea
        id={`${id}-note`}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          if (error) setError(null)
        }}
        rows={2}
        placeholder="Something the next reviewer should know"
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : `${id}-hint`}
        className="min-h-16 rounded-md border-white/10 bg-white/[0.02] text-[13px]"
      />
      <div className="flex items-center justify-between gap-2">
        {error ? (
          <p id={`${id}-err`} role="alert" className="text-xs text-danger">{error}</p>
        ) : (
          <p id={`${id}-hint`} className="text-[11px] text-ink-3">Internal only. Brands never see notes.</p>
        )}
        <Button type="submit" size="sm" variant="secondary" className="h-10 sm:h-8" loading={save.pending} success={save.succeeded}>
          Add note
        </Button>
      </div>
    </form>
  )
}
