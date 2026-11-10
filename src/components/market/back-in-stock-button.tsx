"use client"

import { BellSimpleIcon } from "@phosphor-icons/react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api/client"
import { errorMessage } from "@/lib/api/errors"
import { useSession } from "@/lib/stores/session"

type Watch = { variantId: string; watching: boolean }

export function BackInStockButton({ variantId, className }: { variantId: string; className?: string }) {
  const user = useSession((state) => state.user)
  const requireAuth = useSession((state) => state.requireAuth)
  const [watch, setWatch] = useState<Watch | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    const controller = new AbortController()
    // Its own lookup: a watch on a product that isn't saved doesn't appear in the wishlist.
    void api<Watch>(`/api/wishlist/back-in-stock/${encodeURIComponent(variantId)}`, { signal: controller.signal })
      .then((next) => {
        setWatch(next)
        setError(null)
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(cause, "Your notification status couldn't be loaded."))
      })
    return () => controller.abort()
  }, [user, variantId])

  // Another size's answer doesn't count while this one's loads.
  const active = Boolean(user && watch?.variantId === variantId && watch.watching)

  async function toggle() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      if (active) await api(`/api/wishlist/back-in-stock/${encodeURIComponent(variantId)}`, { method: "DELETE" })
      else await api("/api/wishlist/back-in-stock", { body: { variantId } })
      setWatch({ variantId, watching: !active })
    } catch (cause) {
      setError(errorMessage(cause, "Your notification couldn't be updated."))
    } finally {
      setBusy(false)
    }
  }

  function onClick() {
    const run = () => void toggle()
    if (requireAuth("save", run)) run()
  }

  return <div className={className}>
    <Button type="button" variant={active ? "secondary" : "primary"} size="xl" loading={busy} disabled={busy} aria-pressed={active} onClick={onClick} className="h-14 w-full text-base">
      <BellSimpleIcon className="size-5" aria-hidden />
      {active ? "Stop watching" : "Notify me"}
    </Button>
    {error ? <p role="alert" className="mt-2 text-xs text-danger">{error}</p> : null}
  </div>
}