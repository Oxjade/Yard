"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowsClockwiseIcon, CaretDownIcon, FlaskIcon, ImagesSquareIcon, InstagramLogoIcon, PlugsConnectedIcon, TiktokLogoIcon, UploadSimpleIcon, WarningCircleIcon } from "@phosphor-icons/react"
import { toast } from "sonner"
import { surfaceClass } from "@/components/dashboard/insight/insight-panel"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { Bone } from "@/components/feedback/skeletons"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { useAsyncAction } from "@/hooks/use-async-action"
import { ApiError } from "@/lib/api/client"
import { providerLabels, type SocialAccountDto, type SocialAccountsResult, type SocialProviderId } from "@/lib/api/contracts/social"
import type { BrandProfile } from "@/lib/api/contracts/session"
import { errorMessage, formatWait } from "@/lib/api/errors"
import { disconnectAccount, startConnect, syncNow } from "@/lib/api/social"
import { cn } from "@/lib/utils"
import { ago, can, cantSentence, shortDate } from "./shared"

const icons = { instagram: InstagramLogoIcon, tiktok: TiktokLogoIcon }

/** "Business account", "Creator account". */
const accountTypeText = (t: string | null) => (t === "BUSINESS" ? "Business account" : t === "MEDIA_CREATOR" ? "Creator account" : null)

/** The current time, ticking once a second until `until` (a timestamp) has passed. */
function useNow(until: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!until) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    const stop = window.setTimeout(() => window.clearInterval(id), Math.max(0, until - Date.now()) + 1500)
    return () => {
      window.clearInterval(id)
      window.clearTimeout(stop)
    }
  }, [until])
  return now
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

/** The loading state: a card skeleton with avatar, two lines and a button bone. */
export function ConnectionSkeleton() {
  return (
    <div className={cn(surfaceClass, "grid gap-4 p-5")} aria-hidden>
      <div className="flex items-center gap-3">
        <Bone className="size-11 rounded-full" />
        <div className="grid flex-1 gap-2">
          <Bone className="h-4 w-32" />
          <Bone className="h-3 w-48" />
        </div>
      </div>
      <Bone className="h-10 w-36 rounded-md" />
    </div>
  )
}

type CardProps = {
  account: SocialAccountDto
  brand: BrandProfile | null
  paused: SocialAccountsResult["paused"]
  onChanged: () => void
  onUpload: () => void
  onChoosePosts: (provider: SocialProviderId) => void
}

/**
 * One provider's card on Social connections (§6.1): not configured (Yard's platform keys are
 * missing: the copy asks nothing of the brand), ready to connect, connected (with Sync now,
 * Choose posts and Disconnect), needs reauth, error, paused by Yard, or no permission.
 */
export function ConnectionCard({ account: a, brand, paused, onChanged, onUpload, onChoosePosts }: CardProps) {
  const router = useRouter()
  const label = providerLabels[a.provider]
  const Icon = icons[a.provider]
  const mayConnect = can(brand, "social.connect")
  const disabledReason = paused ? `Yard has paused social connections for your brand: ${paused.reason}` : !mayConnect ? cantSentence(brand, "social.connect") : null
  const [disconnecting, setDisconnecting] = useState(false)
  const syncLimitedUntil = a.syncAvailableAt ? new Date(a.syncAvailableAt).getTime() : 0
  const now = useNow(syncLimitedUntil)
  const limited = syncLimitedUntil > now

  const connect = useAsyncAction(
    async (sandbox: boolean) => {
      const { url } = await startConnect(a.provider, sandbox)
      // The browser goes to the provider's consent page, or the sandbox's page in Studio; the
      // button keeps its spinner until the page changes.
      if (url.startsWith("/")) router.push(url)
      else window.location.assign(url)
      await new Promise(() => {})
    },
    { errorToast: false, onError: (e) => toast.error(`Couldn't start the ${label} connection`, { description: errorMessage(e) }) },
  )
  const sync = useAsyncAction(() => syncNow(a.id!), {
    errorToast: false,
    onSuccess: onChanged,
    onError: (e) => {
      onChanged()
      toast.error("Couldn't sync now", { description: e instanceof ApiError && e.code === "rate_limited" ? `You can sync once every 5 minutes. Try again in ${formatWait(e.retryAfter ?? 300)}.` : errorMessage(e) })
    },
  })

  const connected = a.status === "connected"
  const notConnected = a.status === "not_connected"
  const sandbox = a.mode === "sandbox"
  const reconnect = (
    <Button variant={a.status === "needs_reauth" ? "primary" : "secondary"} disabled={!!disabledReason} loading={connect.pending} onClick={() => void connect.run(sandbox || !a.configured)}>
      Reconnect
    </Button>
  )

  return (
    <section aria-labelledby={`sc-${a.provider}`} className={cn(surfaceClass, "grid content-start gap-4 p-5", a.status === "needs_reauth" && "border-acid/60")}>
      <header className="flex items-start gap-3">
        <span className="relative inline-flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-elevated text-ink">
          {a.avatarSrc ? (
            // A private avatar served to members of this brand: next/image's optimizer would drop the cookie.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={a.avatarSrc} alt="" className="size-full object-cover" />
          ) : (
            <Icon className="size-5" aria-hidden />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`sc-${a.provider}`} className="flex flex-wrap items-center gap-2 text-[15px] font-medium text-ink">
            {notConnected ? label : `@${a.handle ?? ""}`}
            {sandbox && !notConnected ? <StatusBadge tone="muted">Sandbox</StatusBadge> : null}
            {connected ? <StatusBadge tone="success">Connected</StatusBadge> : a.status === "needs_reauth" ? <StatusBadge tone="attention">Needs reconnecting</StatusBadge> : a.status === "error" || a.status === "revoked" ? <StatusBadge tone="danger">{a.status === "revoked" ? "Access removed" : "Error"}</StatusBadge> : null}
          </h2>
          <p className="mt-0.5 text-sm text-ink-2">
            {notConnected ? (a.configured ? "Not connected" : "Not switched on for Yard yet") : [a.displayName, accountTypeText(a.accountType)].filter(Boolean).join(", ") || label}
          </p>
        </div>
      </header>

      {/* What this card says now */}
      {paused ? (
        <p className="text-sm text-ink-2">Yard has paused social connections for your brand: {paused.reason}</p>
      ) : notConnected && !a.configured ? (
        <p className="text-sm text-ink-2">{label} connections aren&apos;t switched on for Yard yet. Upload posts in Content Studio in the meantime.</p>
      ) : notConnected ? (
        <div className="grid gap-1 text-sm text-ink-2">
          <p>Show your {label} posts on your storefront. Yard only reads your profile and posts.</p>
          {a.provider === "instagram" ? <p className="text-xs text-ink-3">Needs an Instagram professional account (Business or Creator). Personal accounts can&apos;t connect — upload posts instead.</p> : null}
        </div>
      ) : connected ? (
        <div className="grid gap-1 text-sm text-ink-2">
          <p>
            Connected {shortDate(a.connectedAt!)}
            {a.connectedBy ? ` by ${a.connectedBy}` : ""}.
          </p>
          <p aria-live="polite">
            {a.syncing || !a.lastSyncAt ? (
              <span className="inline-flex items-center gap-1.5">
                <ArrowsClockwiseIcon className="size-3.5" aria-hidden /> Syncing your posts…
              </span>
            ) : (
              <>
                Synced {ago(a.lastSyncAt)}. {a.postCount === 1 ? "1 post" : `${a.postCount} posts`} imported.
              </>
            )}
          </p>
          {a.syncError ? <p className="text-xs text-ink-3">{a.syncError}</p> : null}
          {sandbox ? <p className="text-xs text-ink-3">Development sandbox: these are sample photos from this machine, not {label}.</p> : null}
        </div>
      ) : (
        <p className={cn("flex items-start gap-2 text-sm", a.status === "needs_reauth" ? "text-ink" : "text-danger")}>
          <WarningCircleIcon className={cn("mt-0.5 size-4 shrink-0", a.status === "needs_reauth" ? "text-acid" : "text-danger")} aria-hidden />
          {a.statusDetail ?? `${label} needs reconnecting.`}
        </p>
      )}

      {disabledReason && !paused ? <p className="text-xs text-ink-2">{disabledReason}</p> : null}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        {notConnected ? (
          a.configured ? (
            <Button variant="primary" disabled={!!disabledReason} loading={connect.pending} onClick={() => void connect.run(false)}>
              <PlugsConnectedIcon aria-hidden /> Connect {label}
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={onUpload}>
                <UploadSimpleIcon aria-hidden /> Upload posts
              </Button>
              <Button variant="secondary" disabled aria-describedby={`sc-${a.provider}-why`}>
                Connect {label}
              </Button>
              <span id={`sc-${a.provider}-why`} className="sr-only">
                {label} connections aren&apos;t switched on for Yard yet.
              </span>
              {a.sandboxAvailable ? (
                <Button variant="secondary" disabled={!!disabledReason} loading={connect.pending} onClick={() => void connect.run(true)}>
                  <FlaskIcon aria-hidden /> Try the development sandbox
                </Button>
              ) : null}
            </>
          )
        ) : connected ? (
          <>
            <Button variant="secondary" disabled={!!disabledReason || limited || a.syncing} loading={sync.pending} onClick={() => void sync.run()}>
              <ArrowsClockwiseIcon aria-hidden />
              {limited ? <span className="tabular">Sync again in {clock(syncLimitedUntil - now)}</span> : "Sync now"}
            </Button>
            <Button variant="secondary" onClick={() => onChoosePosts(a.provider)}>
              <ImagesSquareIcon aria-hidden /> Choose posts
            </Button>
            <Button variant="ghost" disabled={!!disabledReason} onClick={() => setDisconnecting(true)}>
              Disconnect
            </Button>
          </>
        ) : (
          <>
            {reconnect}
            <Button variant="ghost" disabled={!!disabledReason} onClick={() => setDisconnecting(true)}>
              Disconnect
            </Button>
          </>
        )}
      </div>

      {notConnected && a.setup ? <DeveloperSetup provider={a.provider} setup={a.setup} /> : null}

      <DisconnectDialog account={a} open={disconnecting} onOpenChange={setDisconnecting} onDone={onChanged} />
    </section>
  )
}

/** Development only: what an operator registers to switch the live provider on (§6.1). */
function DeveloperSetup({ provider, setup }: { provider: SocialProviderId; setup: NonNullable<SocialAccountDto["setup"]> }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-md border border-dashed border-line-soft">
      <button type="button" aria-expanded={open} aria-controls={`dev-${provider}`} onClick={() => setOpen(!open)} className="flex min-h-10 w-full items-center justify-between gap-2 px-3 text-left text-xs text-ink-2 hover:text-ink">
        For developers
        <CaretDownIcon className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <div id={`dev-${provider}`} className="grid gap-2 border-t border-line-soft px-3 py-3 text-xs text-ink-2">
          <p>Set these in the server&apos;s environment, then restart Yard. This note only shows in development.</p>
          <ul className="grid gap-1">
            {setup.envVars.map((v) => (
              <li key={v}>
                <code className="rounded bg-elevated px-1.5 py-0.5 text-ink">{v}</code>
              </li>
            ))}
          </ul>
          <p>Redirect URI to register with {providerLabels[provider]}:</p>
          <code className="block rounded bg-elevated px-2 py-1.5 break-all text-ink">{setup.redirectUri}</code>
        </div>
      ) : null}
    </div>
  )
}

/** "Disconnect Instagram? Yard deletes its access and stops syncing." with Hide or Delete for the imports. */
function DisconnectDialog({ account: a, open, onOpenChange, onDone }: { account: SocialAccountDto; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const label = providerLabels[a.provider]
  const [choice, setChoice] = useState<"hide" | "delete">("hide")
  const run = useAsyncAction(() => disconnectAccount(a.id!, choice === "delete"), {
    success: (r) => (choice === "delete" ? `${label} disconnected. ${r.posts === 1 ? "1 imported post" : `${r.posts} imported posts`} deleted.` : `${label} disconnected. Imported posts are hidden.`),
    error: `Couldn't disconnect ${label}. Try again.`,
    onSuccess: () => {
      onOpenChange(false)
      onDone()
    },
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Disconnect {label}?</DialogTitle>
          <DialogDescription className="text-ink-2">
            Yard deletes its access and stops syncing.{a.provider === "instagram" && a.mode === "live" ? " You can also remove Yard from your Instagram app settings." : ""}
          </DialogDescription>
        </DialogHeader>
        <RadioGroup value={choice} onValueChange={(v) => setChoice(v as "hide" | "delete")} aria-label="Imported posts" className="gap-2">
          {[
            { v: "hide", t: "Hide imported posts", d: "They leave your storefront. Reconnect later to show them again." },
            { v: "delete", t: "Delete imported posts", d: "Yard deletes them and their files. Posts Yard removed stay listed." },
          ].map((o) => (
            <Label key={o.v} htmlFor={`disc-${a.provider}-${o.v}`} className="flex cursor-pointer items-start gap-3 rounded-md border border-line-soft p-3 font-normal has-[[data-state=checked]]:border-purple">
              <RadioGroupItem id={`disc-${a.provider}-${o.v}`} value={o.v} className="mt-0.5" />
              <span className="grid gap-0.5">
                <span className="text-sm text-ink">{o.t}</span>
                <span className="text-xs text-ink-2">{o.d}</span>
              </span>
            </Label>
          ))}
        </RadioGroup>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" loading={run.pending} onClick={() => void run.run()}>
            Disconnect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
