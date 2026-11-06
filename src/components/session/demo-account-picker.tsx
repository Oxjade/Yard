"use client"

import { useMemo, useState } from "react"
import { CaretDownIcon, CheckIcon } from "@phosphor-icons/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Bone } from "@/components/feedback/skeletons"
import { api } from "@/lib/api/client"
import type { DemoAccountDto, DemoSignInResult } from "@/lib/api/contracts/session"
import { errorMessage } from "@/lib/api/errors"
import { useApi } from "@/lib/api/use-api"
import { afterIdentityChange } from "@/lib/session/identity"
import { useServerSession } from "@/lib/session/use-server-session"
import { cn } from "@/lib/utils"

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

/** Signs in as a demo account of `actor` (ending the previous one of that kind) and refreshes this tab's identity. */
export async function switchDemoAccount(surface: "studio" | "admin", account: DemoAccountDto) {
  const r = await api<DemoSignInResult>("/api/auth/demo", { body: { actor: account.actor, account: account.account, ...(account.brandId ? { brandId: account.brandId } : {}) } })
  await afterIdentityChange(surface)
  return r
}

/** Ends the demo session of the surface's actor kind and refreshes this tab's identity. */
export async function signOutDemo(surface: "studio" | "admin" | "market") {
  const actor = surface === "studio" ? "brand" : surface === "admin" ? "admin" : "shopper"
  await api("/api/auth/demo", { method: "DELETE", query: { actor } })
  await afterIdentityChange(surface)
}

/**
 * The demo account picker for Brand Studio and the Control Center (§2.3). There are no passwords
 * in this build: choosing an account signs in as it on the server (the previous session of that
 * kind ends first), then this tab's session, caches and stream follow.
 */
export function DemoAccountPicker({ surface, open, onOpenChange }: { surface: "studio" | "admin"; open: boolean; onOpenChange: (open: boolean) => void }) {
  const actor = surface === "studio" ? "brand" : "admin"
  const { data, error, isLoading, revalidate } = useApi(open ? `/api/auth/demo?actor=${actor}` : null, (k) => api<{ accounts: DemoAccountDto[] }>(k), { revalidateOnFocus: false })
  const session = useServerSession()
  const currentId = surface === "studio" ? session.brand?.userId : session.admin?.id
  const currentBrand = session.brand?.brand.id
  const [busy, setBusy] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [more, setMore] = useState(false)
  const accounts = useMemo(() => data?.accounts ?? [], [data])
  const main = accounts.filter((a) => !a.more)
  const extra = accounts.filter((a) => a.more)

  async function choose(a: DemoAccountDto) {
    if (busy) return
    setBusy(a.account + (a.brandId ?? ""))
    setFailure(null)
    try {
      await switchDemoAccount(surface, a)
      toast.success(`Signed in as ${a.name}`, { description: surface === "studio" ? `${a.role}, ${a.brandName}. Demo account.` : `${a.role}. Demo account.` })
      onOpenChange(false)
    } catch (e) {
      setFailure(errorMessage(e, "Couldn't switch accounts. Try again."))
    } finally {
      setBusy(null)
    }
  }

  const row = (a: DemoAccountDto) => {
    const key = a.account + (a.brandId ?? "")
    const current = a.account === currentId && (surface === "admin" || a.brandId === currentBrand)
    const disabled = !!a.disabledReason || current || !!busy
    return (
      <li key={key}>
        <button
          type="button"
          onClick={() => void choose(a)}
          disabled={disabled}
          aria-current={current || undefined}
          aria-busy={busy === key || undefined}
          className={cn(
            "flex min-h-14 w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors duration-150",
            current ? "border-purple bg-purple/10" : "border-line-soft bg-card hover:border-white/20 hover:bg-white/[0.03]",
            disabled && !current ? "cursor-not-allowed opacity-50" : "",
          )}
        >
          <span aria-hidden className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-elevated text-[11px] font-semibold text-ink-2">
            {initials(a.name)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-ink">{a.name}</span>
            <span className="block truncate text-xs text-ink-2">{surface === "studio" ? `${a.role}, ${a.brandName}` : a.role}</span>
            {a.disabledReason ? <span className="block text-xs text-ink-3">{a.disabledReason}</span> : a.note ? <span className="block text-xs text-ink-3">{a.note}</span> : null}
          </span>
          {current ? (
            <span className="inline-flex items-center gap-1 text-xs text-violet">
              <CheckIcon aria-hidden className="size-3.5" /> Signed in
            </span>
          ) : busy === key ? (
            <span className="text-xs text-ink-2">Signing in…</span>
          ) : null}
        </button>
      </li>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="text-lg text-ink">{surface === "studio" ? "Switch demo account" : "Switch demo admin"}</DialogTitle>
          <DialogDescription className="text-ink-2">Demo accounts — no passwords in this build.</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <ul className="grid gap-2" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <Bone key={i} className="h-14 w-full rounded-lg" />
            ))}
          </ul>
        ) : error ? (
          <div role="alert" className="grid gap-3 rounded-lg border border-line-soft bg-card p-4 text-sm text-ink-2">
            <p>{errorMessage(error, "Couldn't load the demo accounts.")}</p>
            <div>
              <Button size="sm" variant="secondary" onClick={() => void revalidate()}>
                Try again
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            <ul className="grid gap-2">{main.map(row)}</ul>
            {extra.length ? (
              <div className="grid gap-2">
                <button type="button" aria-expanded={more} onClick={() => setMore((m) => !m)} className="inline-flex h-10 items-center gap-1.5 self-start rounded-md px-1 text-[13px] text-ink-2 hover:text-ink">
                  <CaretDownIcon aria-hidden className={cn("size-3.5 transition-transform duration-150", more && "rotate-180")} />
                  More test accounts
                </button>
                {more ? (
                  <>
                    <p className="text-xs text-ink-3">For checking what each role can do.</p>
                    <ul className="grid gap-2">{extra.map(row)}</ul>
                  </>
                ) : null}
              </div>
            ) : null}
            {failure ? (
              <p role="alert" className="text-xs text-danger">
                {failure}
              </p>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
