"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { CircleNotchIcon as Loader2, WarningCircleIcon } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { ApiError } from "@/lib/api/client"
import { useOrders } from "@/lib/stores/orders"

export function PaymentReturn() {
  const params = useSearchParams()
  const router = useRouter()
  const checkoutId = params.get("checkout")
  const [attempt, setAttempt] = useState(0)
  const [failure, setFailure] = useState<{ checkoutId: string; message: string } | null>(null)
  const error = checkoutId
    ? failure?.checkoutId === checkoutId ? failure.message : null
    : "This payment link is missing its checkout reference."

  useEffect(() => {
    let active = true
    if (!checkoutId) return () => { active = false }
    void useOrders.getState().verifyCheckout(checkoutId).then(() => {
      if (active) router.replace(`/checkout/confirmation?group=${encodeURIComponent(checkoutId)}`)
    }).catch((cause: unknown) => {
      if (!active) return
      setFailure({ checkoutId, message: cause instanceof ApiError ? cause.message : cause instanceof Error ? cause.message : "We couldn't check the payment yet. Try again." })
    })
    return () => { active = false }
  }, [attempt, checkoutId, router])

  if (!error) {
    return (
      <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
        <h1 className="font-display text-display-lg text-ink">Checking your payment</h1>
        <p role="status" className="mt-6 flex items-center gap-3 text-sm text-ink-2">
          <Loader2 className="size-4 animate-spin text-violet" aria-hidden />
          Please keep this page open while Yard confirms the result.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <h1 className="font-display text-display-lg text-ink">Payment not confirmed yet</h1>
      <p role="alert" className="mt-5 flex max-w-xl items-start gap-3 text-sm leading-relaxed text-ink-2">
        <WarningCircleIcon className="mt-0.5 size-5 shrink-0 text-amber-400" aria-hidden />
        {error}
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button variant="primary" onClick={() => { setFailure(null); setAttempt((value) => value + 1) }}>Retry check</Button>
        <Button asChild variant="secondary"><Link href="/you/orders">View your orders</Link></Button>
      </div>
    </div>
  )
}