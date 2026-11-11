"use client"

import { useEffect, useState } from "react"
import { BellIcon as Bell, BellRingingIcon as BellRing } from "@phosphor-icons/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { site } from "@/config/site"
import { useHydrated } from "@/hooks/use-hydrated"
import { api } from "@/lib/api/client"
import { errorMessage } from "@/lib/api/errors"
import { revalidatePrefix } from "@/lib/api/use-api"
import { useSaved } from "@/lib/stores/saved"
import { DEMO_SHOPPER, useSession } from "@/lib/stores/session"
import { cn } from "@/lib/utils"
import type { Drop } from "@/lib/data/types"

type DropParticipation = { reminders: Set<string>; entries: Set<string> }
type MyDropsResponse = {
  reminders: { dropId: string }[]
  entries: { drop: { id: string }; status: string }[]
}

let participationCache: { userId: string; value: DropParticipation; expiresAt: number; pending?: Promise<DropParticipation> } | null = null
let participationGeneration = 0

function clearParticipationCache() {
  participationGeneration += 1
  participationCache = null
}

function getParticipation(userId: string): Promise<DropParticipation> {
  const cached = participationCache
  if (cached?.userId === userId) {
    if (cached.pending) return cached.pending
    if (cached.expiresAt > Date.now()) return Promise.resolve(cached.value)
  }

  const generation = ++participationGeneration
  const pending = api<MyDropsResponse>("/api/drops/me").then((result) => {
    const value = {
      reminders: new Set(result.reminders.map((reminder) => reminder.dropId)),
      entries: new Set(result.entries.filter((entry) => entry.status !== "withdrawn").map((entry) => entry.drop.id)),
    }
    if (participationGeneration === generation) {
      participationCache = { userId, value, expiresAt: Date.now() + 30_000 }
    }
    return value
  }).catch((cause: unknown) => {
    if (participationGeneration === generation) participationCache = null
    throw cause
  })
  participationCache = { userId, value: { reminders: new Set(), entries: new Set() }, expiresAt: 0, pending }
  return pending
}

function updateParticipation(userId: string, dropId: string, draw: boolean, active: boolean) {
  const cached = participationCache
  if (!cached || cached.userId !== userId || cached.pending) return
  const reminders = new Set(cached.value.reminders)
  const entries = new Set(cached.value.entries)
  const target = draw ? entries : reminders
  if (active) target.add(dropId)
  else target.delete(dropId)
  participationCache = { userId, value: { reminders, entries }, expiresAt: Date.now() + 30_000 }
}

/**
 * A drop reminder, or a draw entry. `mode` says which: a draw takes entries only while its
 * entries are open, so before that the live pages pass "reminder" (and "entry" once open).
 * Without `mode` the access decides (the sample pages, which follow the demo clock).
 * `quiet` skips the toast where the page already explains the result next to
 * the button; `onChange` runs after the server accepted a change, so the page can reload its state.
 */
export function NotifyButton({
  drop,
  mode,
  size = "sm",
  variant = "secondary",
  quiet = false,
  className,
  onChange,
}: {
  drop: Pick<Drop, "id" | "access">
  mode?: "entry" | "reminder"
  size?: "sm" | "default" | "lg"
  variant?: "secondary" | "glass" | "primary"
  quiet?: boolean
  className?: string
  onChange?: (active: boolean) => void
}) {
  const hydrated = useHydrated()
  const on = useSaved((s) => s.notify.includes(drop.id))
  const toggle = useSaved((s) => s.toggleNotify)
  const userId = useSession((s) => s.user?.id ?? null)
  const requireAuth = useSession((s) => s.requireAuth)
  const demo = userId === DEMO_SHOPPER
  const serverUserId = userId && !demo ? userId : null
  const draw = mode ? mode === "entry" : drop.access === "draw"
  const reminderForDraw = !draw && drop.access === "draw"
  const [serverActive, setServerActive] = useState<{ userId: string; dropId: string; active: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [requestError, setRequestError] = useState<{ userId: string; dropId: string; message: string } | null>(null)

  useEffect(() => {
    if (!serverUserId) {
      if (!userId || demo) clearParticipationCache()
      return
    }

    let current = true
    void getParticipation(serverUserId).then((value) => {
      if (current) {
        setServerActive({ userId: serverUserId, dropId: drop.id, active: (draw ? value.entries : value.reminders).has(drop.id) })
        setRequestError((previous) => previous?.userId === serverUserId && previous.dropId === drop.id ? null : previous)
      }
    }).catch((cause: unknown) => {
      if (current) setRequestError({ userId: serverUserId, dropId: drop.id, message: errorMessage(cause, "Your drop status couldn't be loaded.") })
    })
    return () => { current = false }
  }, [demo, draw, drop.id, serverUserId, userId])

  const active = hydrated && (demo ? on : serverActive?.userId === serverUserId && serverActive.dropId === drop.id && serverActive.active)
  const error = requestError?.userId === userId && requestError.dropId === drop.id ? requestError.message : null
  const label = draw ? (active ? "Entered" : "Enter the draw") : active ? "Reminder set" : reminderForDraw ? "Remind me to enter" : "Notify me"

  function onClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()

    const run = async () => {
      if (busy) return
      setBusy(true)
      setRequestError(null)
      try {
        const user = useSession.getState().user
        if (user?.id === DEMO_SHOPPER) {
          const next = toggle(drop.id)
          if (!quiet) toast(next ? (draw ? "Entry saved in this browser" : "Reminder saved in this browser") : (draw ? "Entry withdrawn" : "Reminder removed"), {
            description: next ? (draw ? "Picking winners isn't connected in this build." : `You'll see an alert in Notifications when it opens while ${site.name} is open. Email and push aren't connected in this build.`) : undefined,
          })
          return
        }
        if (!user) return

        const participation = await getParticipation(user.id)
        if (useSession.getState().user?.id !== user.id) return
        const wasActive = (draw ? participation.entries : participation.reminders).has(drop.id)
        const path = `/api/drops/${encodeURIComponent(drop.id)}/${draw ? "entry" : "reminder"}`
        await api(path, { method: wasActive ? "DELETE" : "POST" })
        updateParticipation(user.id, drop.id, draw, !wasActive)
        setServerActive({ userId: user.id, dropId: drop.id, active: !wasActive })
        revalidatePrefix("market.drops:")
        onChange?.(!wasActive)
        if (!quiet) toast.success(draw ? (wasActive ? "Entry withdrawn" : "Entered the draw") : (wasActive ? "Reminder removed" : "Reminder set"))
      } catch (cause) {
        const message = errorMessage(cause, draw ? "Your draw entry couldn't be updated." : "Your reminder couldn't be updated.")
        const userId = useSession.getState().user?.id
        if (userId) setRequestError({ userId, dropId: drop.id, message })
        toast.error(message)
      } finally {
        setBusy(false)
      }
    }
    if (requireAuth("notify", run)) run()
  }

  return <span className="inline-flex max-w-full flex-col items-start">
    <Button type="button" size={size} variant={active ? "brand" : variant} loading={busy} disabled={busy} aria-pressed={active} onClick={onClick} className={cn("relative z-10", className)}>
      {active ? <BellRing /> : <Bell />}
      {label}
    </Button>
    {error ? <span role="alert" className="mt-1 max-w-[16rem] text-xs text-danger">{error}</span> : null}
  </span>
}
