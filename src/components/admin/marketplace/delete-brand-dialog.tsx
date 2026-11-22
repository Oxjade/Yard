"use client"

import { useCallback, useId, useState } from "react"
import { toast } from "sonner"
import { ArchiveIcon, TrashIcon, WarningIcon } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ReauthCodeField, useReauth } from "@/components/admin/finance/reauth"
import { getBrandRemoval, removeBrand } from "@/lib/api/admin"
import type { BrandRemovalFootprintDto, BrandRemovalPreviewDto, BrandRemovalRecordsDto } from "@/lib/api/contracts/brand-removal"
import { ApiError } from "@/lib/api/client"
import { errorMessage, fieldErrors } from "@/lib/api/errors"
import { useApi, revalidatePrefix } from "@/lib/api/use-api"
import { canAdmin, needsRole } from "@/lib/permissions"
import { useServerSession } from "@/lib/session/use-server-session"
import { cn } from "@/lib/utils"
import { DetailSection, insetClass } from "./detail-sheet"

/**
 * Admin › Brands › Delete brand. An irreversible destructive action, so it confirms in a modal
 * (AGENTS.md › UI patterns): the server's preview says which of the two outcomes happens and why
 * (erased, or closed because it has orders or money on record), with the counts; the admin types
 * the handle and a reason; a re-auth code is asked for when the server wants one. Owner admins only
 * (brands.delete): everyone else never sees the action.
 */

export type DeleteTarget = { brandId: string; name: string; handle: string }

/** Whether this admin may delete brands, or why not (for a disabled control). */
export function useCanDeleteBrands(): { can: boolean; reason?: string } {
  const admin = useServerSession((s) => s.admin)
  if (!admin) return { can: false }
  return canAdmin(admin.role, "brands.delete") ? { can: true } : { can: false, reason: needsRole("brands.delete") }
}

/** One dialog per view: `ask(target)` opens it; `onDone` runs after the brand is gone or closed. */
export function useDeleteBrand(onDone?: (r: { brandId: string; mode: "delete" | "close" }) => void) {
  const [state, setState] = useState<{ target: DeleteTarget; n: number; open: boolean } | null>(null)
  const ask = useCallback((target: DeleteTarget) => setState((s) => ({ target, n: (s?.n ?? 0) + 1, open: true })), [])
  const dialog = state ? (
    <DeleteBrandDialog
      key={state.n}
      target={state.target}
      open={state.open}
      onOpenChange={(open) => setState((s) => (s ? { ...s, open } : s))}
      onDone={(r) => {
        setState((s) => (s ? { ...s, open: false } : s))
        onDone?.(r)
      }}
    />
  ) : null
  return { ask, dialog }
}

const FOOTPRINT: [keyof BrandRemovalFootprintDto, string, string][] = [
  ["products", "product", "products"],
  ["variants", "variant", "variants"],
  ["collections", "collection", "collections"],
  ["mediaFiles", "photo or file", "photos and files"],
  ["members", "team member", "team members"],
  ["invites", "invite or claim link", "invites and claim links"],
  ["applications", "application", "applications"],
  ["imports", "website import", "website imports"],
  ["watches", "website watch", "website watches"],
  ["suggestions", "suggestion from Yard", "suggestions from Yard"],
  ["posts", "post", "posts"],
  ["places", "place", "places"],
  ["drops", "drop", "drops"],
  ["conversations", "conversation", "conversations"],
  ["socialAccounts", "social connection", "social connections"],
  ["newsletters", "newsletter", "newsletters"],
  ["notifications", "notification", "notifications"],
  ["follows", "follower", "followers"],
  ["wishlist", "wishlist save", "wishlist saves"],
]
const RECORDS: [keyof BrandRemovalRecordsDto, string, string][] = [
  ["orders", "order", "orders"],
  ["refunds", "refund", "refunds"],
  ["returns", "return", "returns"],
  ["disputes", "dispute", "disputes"],
  ["complaints", "delivery complaint", "delivery complaints"],
  ["payouts", "payout", "payouts"],
  ["transfers", "transfer", "transfers"],
  ["ledgerEntries", "ledger entry", "ledger entries"],
  ["payoutAccounts", "payout account", "payout accounts"],
]
const counted = <K extends string>(list: [K, string, string][], values: Record<K, number>) =>
  list.filter(([k]) => values[k] > 0).map(([k, one, many]) => ({ key: k, label: values[k] === 1 ? one : many, value: values[k] }))

const WHAT: Record<"delete" | "close", string[]> = {
  delete: [
    "The brand, its storefront, products, photos and files are erased for good.",
    "Team members lose access and are signed out of the brand. Their accounts stay.",
    "Followers, wishlist saves, invites, imports, suggestions and its notifications go too.",
    "Its pages leave search, the sitemap, feeds, the home grid and Charts. The handle becomes free.",
  ],
  close: [
    "Orders, refunds, payouts and the ledger stay on record, readable by shoppers and Yard.",
    "Every product is unpublished and the storefront goes offline (pages show not found).",
    "Team members lose access and are signed out. Pending invites and claim links stop working.",
    "It leaves search, the sitemap, feeds, the home grid and Charts. The handle stays reserved.",
  ],
}

function DeleteBrandDialog({ target, open, onOpenChange, onDone }: { target: DeleteTarget; open: boolean; onOpenChange: (o: boolean) => void; onDone: (r: { brandId: string; mode: "delete" | "close" }) => void }) {
  const id = useId()
  const preview = useApi(open ? `brand-removal:${target.brandId}` : null, () => getBrandRemoval(target.brandId), { revalidateOnFocus: false })
  const plan: BrandRemovalPreviewDto | undefined = preview.data
  const reauth = useReauth()
  const [handle, setHandle] = useState("")
  const [reason, setReason] = useState("")
  const [attempted, setAttempted] = useState(false)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<{ message: string; conflict: boolean } | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})

  const mode = plan?.mode
  const closed = !!plan?.brand.closedAt
  const handleOk = !!plan && handle.trim().replace(/^@/, "").toLowerCase() === plan.brand.handle.toLowerCase()
  const reasonProblem = reason.trim().length < 8 ? "Write at least 8 characters so the next person understands the decision." : null
  const handleProblem = !handleOk ? `Type ${plan?.brand.handle ?? target.handle} exactly to confirm.` : null
  const verb = mode === "close" ? "Close" : "Delete"

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (pending || !plan || closed) return
    setAttempted(true)
    if (reasonProblem || handleProblem) {
      document.getElementById(reasonProblem ? `${id}-reason` : `${id}-handle`)?.focus()
      return
    }
    setPending(true)
    setFailure(null)
    setFields({})
    try {
      if (!(await reauth.verify())) return
      const r = await removeBrand(plan.brand.id, { mode: plan.mode, confirmHandle: handle.trim(), reason: reason.trim() })
      toast.success(r.mode === "delete" ? `${r.brand.name} deleted` : `${r.brand.name} closed`, {
        description: r.mode === "delete" ? "Erased with its products and files. Recorded in the audit log." : "Its orders and payouts stay on record. Recorded in the audit log.",
      })
      // Close the sheet first, so it never re-reads a brand that's gone; then the lists refresh.
      onDone({ brandId: r.brand.id, mode: r.mode })
      revalidatePrefix("admin:")
    } catch (cause) {
      if (reauth.catches(cause)) return
      setFields(fieldErrors(cause))
      setFailure({ message: errorMessage(cause, "That didn't go through, so nothing changed."), conflict: cause instanceof ApiError && cause.status === 409 })
    } finally {
      setPending(false)
    }
  }

  const facts = plan ? counted(FOOTPRINT, plan.footprint) : []
  const records = plan ? counted(RECORDS, plan.records) : []

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[520px]" data-testid="delete-brand-dialog">
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle className="font-label pr-6 text-base">{plan ? `${verb} ${plan.brand.name}?` : `Delete ${target.name}?`}</DialogTitle>
            <DialogDescription className="text-ink-2">{plan ? plan.why : preview.error ? errorMessage(preview.error) : `Checking what ${target.name} has on record…`}</DialogDescription>
          </DialogHeader>

          {plan && !closed ? (
            <div className={cn("grid gap-2 rounded-md border px-3 py-2.5", mode === "delete" ? "border-danger/40 bg-danger/[0.06]" : "border-ink/30 bg-white/[0.04]")} data-mode={mode}>
              <p className="flex items-center gap-2 text-[13px] font-medium text-ink">
                {mode === "delete" ? <TrashIcon aria-hidden className="size-4 text-danger" /> : <ArchiveIcon aria-hidden className="size-4" />}
                {mode === "delete" ? "Erased completely" : "Closed, not erased"}
              </p>
              <ul className="grid list-disc gap-1 pl-5 text-[12px] leading-snug text-ink-2">
                {WHAT[plan.mode].map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {plan && records.length ? (
            <div className="grid gap-1.5">
              <p className="text-[11px] text-ink-3">Kept on record</p>
              <dl className="flex flex-wrap gap-x-4 gap-y-1 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2 text-[12px]">
                {records.map((f) => (
                  <div key={f.key} className="flex min-w-0 items-baseline gap-1.5">
                    <dd className="text-ink tabular">{f.value}</dd>
                    <dt className="text-ink-3">{f.label}</dt>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          {plan && facts.length ? (
            <div className="grid gap-1.5">
              <p className="text-[11px] text-ink-3">{mode === "delete" ? "Erased" : "Taken down or removed"}</p>
              <dl className="flex flex-wrap gap-x-4 gap-y-1 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2 text-[12px]">
                {facts.map((f) => (
                  <div key={f.key} className="flex min-w-0 items-baseline gap-1.5">
                    <dd className="text-ink tabular">{f.value}</dd>
                    <dt className="text-ink-3">{f.label}</dt>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          {closed ? (
            <p className="flex items-start gap-2 rounded-md border border-ink/40 bg-white/[0.04] px-3 py-2.5 text-[12px] text-ink">
              <WarningIcon aria-hidden className="mt-px size-3.5 shrink-0" />
              <span>{plan?.brand.name} is already closed. Nothing more can be done to it here.</span>
            </p>
          ) : null}

          {plan && !closed ? (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-reason`} className="gap-1">
                  Reason, for the audit log<span aria-hidden className="text-danger">*</span>
                </Label>
                <Textarea
                  id={`${id}-reason`}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  required
                  aria-invalid={attempted && !!(reasonProblem || fields.reason)}
                  aria-describedby={`${id}-reason-note`}
                  placeholder="For example: test brand created during a security check"
                  className="min-h-16 text-[13px]"
                />
                <p id={`${id}-reason-note`} className={cn("text-xs", attempted && (reasonProblem || fields.reason) ? "text-danger" : "text-ink-3")} role={attempted && reasonProblem ? "alert" : undefined}>
                  {(attempted && (reasonProblem ?? fields.reason)) || "Recorded with your name, the brand and the counts above."}
                </p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-handle`} className="gap-1">
                  Type <span className="font-mono text-ink">{plan.brand.handle}</span> to confirm<span aria-hidden className="text-danger">*</span>
                </Label>
                <Input
                  id={`${id}-handle`}
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  aria-invalid={attempted && !!(handleProblem || fields.confirmHandle)}
                  aria-describedby={`${id}-handle-note`}
                  className="font-mono"
                />
                {attempted && (handleProblem || fields.confirmHandle) ? (
                  <p id={`${id}-handle-note`} role="alert" className="text-xs text-danger">
                    {fields.confirmHandle ?? handleProblem}
                  </p>
                ) : (
                  <p id={`${id}-handle-note`} className="text-xs text-ink-3">
                    This can&apos;t be undone.
                  </p>
                )}
              </div>
              <ReauthCodeField reauth={reauth} id={`${id}-code`} />
            </>
          ) : null}

          {failure ? (
            <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger">
              <span className="min-w-0">{failure.message}</span>
              {failure.conflict ? (
                <Button type="button" size="xs" variant="secondary" onClick={() => void preview.revalidate()}>
                  Reload
                </Button>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="secondary" disabled={pending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {plan && !closed ? (
              <Button type="submit" variant="destructive-solid" loading={pending} disabled={reauth.waiting} data-testid="delete-brand-confirm">
                {mode === "delete" ? <TrashIcon /> : <ArchiveIcon />} {verb} brand
              </Button>
            ) : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The last section of a brand's sheet (Brands review sheet, Founding tray): the danger action.
 * Owner admins only; a closed brand says so instead.
 */
export function DeleteBrandSection({ target, closedAt, onAsk }: { target: DeleteTarget; closedAt?: string | null; onAsk: (t: DeleteTarget) => void }) {
  const allowed = useCanDeleteBrands()
  if (!allowed.can) return null
  return (
    <DetailSection title="Danger zone">
      <div className={cn("grid gap-2.5 px-3 py-3", insetClass, "border-danger/30")}>
        {closedAt ? (
          <p className="text-[12.5px] text-ink-2">Yard closed this brand. Its orders and payouts stay on record; nothing else can change.</p>
        ) : (
          <>
            <p className="text-[12.5px] text-ink-2">
              Delete erases the brand with everything that belongs only to it. A brand with orders, payouts or other money on record is closed instead, so that trail survives. You&apos;ll see which before confirming.
            </p>
            <Button type="button" size="sm" variant="destructive" className="h-10 w-full sm:h-9 sm:w-fit" onClick={() => onAsk(target)} data-testid="delete-brand-open">
              <TrashIcon /> Delete brand
            </Button>
          </>
        )}
      </div>
    </DetailSection>
  )
}
