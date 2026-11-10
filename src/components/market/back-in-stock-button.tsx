"use client"

import { BellSimpleIcon } from "@phosphor-icons/react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api/client"
import { errorMessage } from "@/lib/api/errors"
import { useSession } from "@/lib/stores/session"

type Wishlist = { items: { backInStockVariantIds: string[] }[] }

export function BackInStockButton({ variantId, className }: { variantId: string; className?: string }) {
  const user = useSession((state) => state.user)
  const requireAuth = useSession((state) => state.requireAuth)
  const [watching, setWatching] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    const controller = new AbortController()
    void api<Wishlist>("/api/wishlist", { signal: controller.signal })
      .then(({ items }) => setWatching(items.some((item) => item.backInStockVariantIds.includes(variantId))))
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(cause, "Your notification status couldn't be loaded."))
      })
    return () => controller.abort()
  }, [user, variantId])

  const active = Boolean(user && watching)

  async function toggle() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      if (active) await api(`/api/wishlist/back-in-stock/${variantId}`, { method: "DELETE" })
      else await api("/api/wishlist/back-in-stock", { body: { variantId } })
      setWatching(!active)
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