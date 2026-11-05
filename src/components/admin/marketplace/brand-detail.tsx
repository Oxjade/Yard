"use client"

import { useId, useState } from "react"
import { ProhibitIcon as Ban, CheckIcon as Check, CheckCircleIcon as CheckCircle2, CircleDashedIcon as CircleDashed, ClockIcon as Clock3, ArrowCounterClockwiseIcon as RotateCcw, ShieldWarningIcon as ShieldAlert, ShieldCheckIcon as ShieldCheck, XCircleIcon as XCircle } from "@phosphor-icons/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { StatusBadge } from "@/components/dashboard/status-badge"
import type { BrandApplication, BrandReviewStatus } from "@/lib/data/admin"
import { useAdmin } from "@/lib/stores/admin"
import { cn } from "@/lib/utils"
import { Initials } from "./data-table"
import { verificationChecklist, type CheckState } from "./derive"
import { ActionBar, ActivityList, DetailSection, DetailSheet, Facts, LinkRow } from "./detail-sheet"
import { categoryName, countryName, daysSince, formatDate, plural, relDays } from "./format"
import { brandStatusMeta, kycMeta, riskMeta } from "./meta"
import { ReasonDialog, type ReasonAction } from "./reason-dialog"

type BrandActionKey = "approve" | "verify" | "restrict" | "suspend" | "reinstate"

const NOTE_ACTION = "Added internal note"

const actionDefs: Record<BrandActionKey, { label: string; to: BrandReviewStatus; icon: React.ComponentType<{ className?: string }>; button: "primary" | "secondary" | "destructive"; dialog: (a: BrandApplication) => ReasonAction; toast: (a: BrandApplication) => [string, string] }> = {
  approve: {
    label: "Approve",
    to: "verified",
    icon: Check,
    button: "primary",
    dialog: (a) => ({
      title: `Approve ${a.brandName}?`,
      body: "The storefront and its products go live on the marketplace and the brand moves to Verified. Payouts start on the new-brand reserve.",
      confirmLabel: "Approve brand",
      tone: "primary",
      presets: ["Documents and catalogue checked", "KYC verified, catalogue meets the quality bar", "Known maker, vouched for by curation"],
      warning: a.kyc !== "verified" ? `Identity check is ${kycMeta[a.kyc].label.toLowerCase()}. Approving now lets the brand sell before KYC is complete.` : undefined,
    }),
    toast: (a) => [`${a.brandName} approved`, "Moved to Verified and recorded in the audit log."],
  },
  verify: {
    label: "Verify",
    to: "verified",
    icon: ShieldCheck,
    button: "primary",
    dialog: (a) => ({
      title: `Verify ${a.brandName}?`,
      body: "Lifts the restriction. Listings show in discovery and search again, new products can be published and held payouts are released after the reserve.",
      confirmLabel: "Verify brand",
      tone: "primary",
      presets: ["Re-verification passed", "Appeal upheld after a document check", "Rights holder withdrew the complaint"],
      warning: a.kyc === "failed" ? "The last identity check failed. Make sure a new check has passed before verifying." : undefined,
    }),
    toast: (a) => [`${a.brandName} verified`, "Restriction lifted and recorded in the audit log."],
  },
  restrict: {
    label: "Restrict",
    to: "restricted",
    icon: ShieldAlert,
    button: "secondary",
    dialog: (a) => ({
      title: `Restrict ${a.brandName}?`,
      body: "Listings are hidden from discovery and search, new products can't be published and payouts are held. The brand can still fulfil open orders.",
      confirmLabel: "Restrict brand",
      tone: "destructive",
      presets: ["Listings reference third-party trademarks", "Identity check failed", "Repeated policy warnings"],
    }),
    toast: (a) => [`${a.brandName} restricted`, "Listings hidden and payouts held."],
  },
  suspend: {
    label: "Suspend",
    to: "suspended",
    icon: Ban,
    button: "destructive",
    dialog: (a) => ({
      title: `Suspend ${a.brandName}?`,
      body: "The storefront and every product are hidden, checkout is blocked and payouts are held until the brand is reinstated. The brand is told by email.",
      confirmLabel: "Suspend brand",
      tone: "destructive",
      presets: ["Counterfeit goods confirmed", "Chargeback rate above the limit", "Fraud or identity misuse"],
    }),
    toast: (a) => [`${a.brandName} suspended`, "Storefront hidden and payouts held."],
  },
  reinstate: {
    label: "Reinstate",
    to: "verified",
    icon: RotateCcw,
    button: "primary",
    dialog: (a) => ({
      title: `Reinstate ${a.brandName}?`,
      body: "Restores the storefront and listings. Held payouts are released once the standard reserve period has passed.",
      confirmLabel: "Reinstate brand",
      tone: "primary",
      presets: ["Appeal accepted", "Issue resolved with the brand", "Suspended in error"],
    }),
    toast: (a) => [`${a.brandName} reinstated`, "Storefront and listings restored."],
  },
}

/** Only the transitions the brand's current status allows. */
const allowed: Record<BrandReviewStatus, BrandActionKey[]> = {
  pending_review: ["approve", "restrict", "suspend"],
  verified: ["restrict", "suspend"],
  restricted: ["verify", "suspend"],
  suspended: ["reinstate"],
}

const checkIcon: Record<CheckState, { icon: React.ComponentType<{ className?: string }>; className: string; label: string }> = {
  done: { icon: CheckCircle2, className: "text-violet", label: "Done" },
  review: { icon: Clock3, className: "text-ink-2", label: "In review" },
  missing: { icon: CircleDashed, className: "text-ink-3", label: "Missing" },
  failed: { icon: XCircle, className: "text-danger", label: "Failed" },
}

export function BrandDetail({ id, open, onOpenChange }: { id: string | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const app = useAdmin((s) => s.applications.find((a) => a.id === id))
  const audit = useAdmin((s) => s.audit)
  const moderation = useAdmin((s) => s.moderation)
  const setStatus = useAdmin((s) => s.setApplicationStatus)
  const [pending, setPending] = useState<BrandActionKey | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  if (!app) return null

  const entries = audit.filter((e) => e.target === app.brandName || e.target.startsWith(`${app.brandName},`) || e.target.startsWith(`${app.brandName} (`) || e.target.endsWith(`(${app.brandName})`))
  const notes = entries.filter((e) => e.action === NOTE_ACTION)
  const checklist = verificationChecklist(app)
  const done = checklist.filter((c) => c.state === "done").length
  const cases = moderation.filter((m) => m.brandName === app.brandName)
  const openCases = cases.filter((m) => m.status === "open" || m.status === "escalated").length
  const status = brandStatusMeta[app.status]

  function run(key: BrandActionKey) {
    setPending(key)
    setDialogOpen(true)
  }

  async function confirm(reason: string) {
    if (!pending || !app) return
    const def = actionDefs[pending]
    setStatus(app.id, def.to, reason)
    const [title, description] = def.toast(app)
    toast(title, { description })
  }

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
        </>
      }
      actions={
        <ActionBar
          note={app.status === "pending_review" ? `${queueAge(app.submittedAt)} Every decision needs a reason.` : "Every decision needs a reason and is recorded in the audit log."}
          actions={allowed[app.status].map((key) => ({ key, label: actionDefs[key].label, icon: actionDefs[key].icon, variant: actionDefs[key].button, onSelect: () => run(key) }))}
        />
      }
    >
      <Facts
        items={[
          { label: "Category", value: categoryName(app.category) },
          { label: "Products", value: <span className="tabular">{app.products}</span> },
          { label: "Submitted", value: <time dateTime={app.submittedAt} title={formatDate(app.submittedAt)}>{formatDate(app.submittedAt)}</time> },
          { label: "Open cases", value: openCases ? <span className="text-acid tabular">{openCases}</span> : <span className="text-ink-2">None</span> },
        ]}
      />

      <DetailSection title="Verification" aside={<span className="text-[11px] text-ink-3 tabular">{done} of {checklist.length} complete</span>}>
        <ul className="divide-y divide-line-soft rounded-lg border border-line-soft bg-card">
          {checklist.map((c) => {
            const meta = checkIcon[c.state]
            return (
              <li key={c.key} className="flex items-start gap-2.5 px-3 py-2.5">
                <meta.icon className={cn("mt-0.5 size-4 shrink-0", meta.className)} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] text-ink">{c.label}</span>
                  <span className="block text-[11px] text-ink-3">{c.detail}</span>
                </span>
                <span className={cn("shrink-0 text-[11px]", c.state === "failed" ? "text-danger" : c.state === "done" ? "text-ink-2" : "text-ink-3")}>{meta.label}</span>
              </li>
            )
          })}
        </ul>
      </DetailSection>

      <DetailSection title="Notes">
        <div className="rounded-lg border border-line-soft bg-card">
          <div className="px-3 py-2.5">
            <p className="text-[11px] text-ink-3">Review summary</p>
            <p className="mt-0.5 text-[13px] text-ink-2">{app.notes}</p>
          </div>
          {notes.length ? (
            <ul className="divide-y divide-line-soft border-t border-line-soft">
              {notes.map((n) => (
                <li key={n.id} className="px-3 py-2.5">
                  <p className="text-[13px] text-ink">{n.reason}</p>
                  <p className="mt-0.5 text-[11px] text-ink-3">{n.actor}, {relDays(n.at).toLowerCase()}</p>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <NoteForm brandName={app.brandName} />
      </DetailSection>

      <DetailSection title="Activity">
        <ActivityList entries={entries.filter((e) => e.action !== NOTE_ACTION)} extra={[{ at: app.submittedAt, label: "Application submitted", detail: `${app.products} products, ${categoryName(app.category).toLowerCase()}` }]} />
      </DetailSection>

      <DetailSection title="Links">
        <ul className="grid gap-1.5">
          {app.brandId ? (
            <li>
              <LinkRow onNavigate={() => onOpenChange(false)} href={`/brands/${app.handle}`} label="View storefront" hint={`/brands/${app.handle}`} />
            </li>
          ) : (
            <li className="rounded-md border border-dashed border-line px-3 py-2 text-[12px] text-ink-3">{app.status === "pending_review" ? "No storefront yet. It appears once the brand is approved and publishes." : "This brand has no public storefront."}</li>
          )}
          <li>
            <LinkRow
              onNavigate={() => onOpenChange(false)}
              href={cases.length ? `/admin/products?case=${(cases.find((m) => m.status === "open" || m.status === "escalated") ?? cases[0]).id}` : "/admin/products"}
              label={cases.length ? "Moderation cases" : "Moderation queue"}
              hint={cases.length ? `${cases.length} ${cases.length === 1 ? "case" : "cases"} for this brand, ${openCases} open` : "No cases for this brand"}
            />
          </li>
          <li>
            <LinkRow onNavigate={() => onOpenChange(false)} href="/admin/finance?tab=payouts" label="Payouts and ledger" hint="Finance, payouts" />
          </li>
        </ul>
      </DetailSection>

      <ReasonDialog action={pending ? actionDefs[pending].dialog(app) : null} open={dialogOpen} onOpenChange={setDialogOpen} onConfirm={confirm} />
    </DetailSheet>
  )
}

function queueAge(iso: string) {
  const d = daysSince(iso)
  return d === 0 ? "Submitted today." : `In the queue for ${plural(d, "day")}.`
}

function NoteForm({ brandName }: { brandName: string }) {
  const id = useId()
  const log = useAdmin((s) => s.log)
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const v = text.trim()
    if (v.length < 3) {
      setError("Write the note first.")
      return
    }
    log(NOTE_ACTION, brandName, v)
    setText("")
    setError(null)
    toast("Note added", { description: `Visible to the review team on ${brandName}.` })
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-1.5">
      <label htmlFor={`${id}-note`} className="sr-only">Internal note</label>
      <Textarea
        id={`${id}-note`}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          if (error) setError(null)
        }}
        rows={2}
        placeholder="Add an internal note for the review team"
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : undefined}
        className="min-h-16 rounded-md border-line bg-card text-[13px]"
      />
      <div className="flex items-center justify-between gap-2">
        {error ? <p id={`${id}-err`} role="alert" className="text-xs text-danger">{error}</p> : <p className="text-[11px] text-ink-3">Internal only. The brand never sees notes.</p>}
        <Button type="submit" size="xs" variant="secondary">Add note</Button>
      </div>
    </form>
  )
}
