"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { CircleNotchIcon as Loader2, WarningCircleIcon } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { ApiError } from "@/lib/api/client"
import { useOrders } from "@/lib/stores/orders"

/** How long the page waits for the provider's final answer before showing the order as pending. */
const POLL_FOR_MS = 90_000

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The payment provider's return (/checkout/confirm?checkout={id}): asks the server to verify the
 * payment, then polls the checkout with backoff while the provider is still confirming (bank
 * transfer, USSD and mobile money settle later), and opens the confirmation once the answer is
 * final or the wait runs out. The confirmation reads the server when this browser doesn't hold
 * the checkout.
 */
export function PaymentReturn() {
  const params = useSearchParams()
  const router = useRouter()
  const checkoutId = params.get("checkout")
  const [attempt, setAttempt] = useState(0)
  const [waiting, setWaiting] = useState(false)
  const [failure, setFailure] = useState<{ checkoutId: string; message: string } | null>(null)
  const error = checkoutId
    ? failure?.checkoutId === checkoutId ? failure.message : null
    : "This payment link is missing its checkout reference."

  useEffect(() => {
    let active = true
    if (!checkoutId) return () => { active = false }
    void (async () => {
      const orders = useOrders.getState()
      let checkout = await orders.verifyCheckout(checkoutId)
      const deadline = Date.now() + POLL_FOR_MS
      let delay = 2_000
      let polls = 0
      while (active && checkout.status === "pending_payment" && !checkout.payment?.stub && Date.now() < deadline) {
        if (polls === 2) setWaiting(true)
        await pause(delay)
        if (!active) return
        delay = Math.min(Math.round(delay * 1.6), 10_000)
        polls++
        // Mostly a plain read (the webhook settles it); every third look asks the provider again.
        checkout = polls % 3 === 0 ? await orders.verifyCheckout(checkoutId) : await orders.refreshCheckout(checkoutId)
      }
      if (active) router.replace(`/checkout/confirmation?group=${encodeURIComponent(checkoutId)}`)
    })().catch((cause: unknown) => {
      if (!active) return
      setFailure({ checkoutId, message: cause instanceof ApiError ? cause.message : cause instanceof Error ? cause.message : "We couldn't check the payment yet. Try again." })
    })
    return () => { active = false }
  }, [attempt, checkoutId, router])

  if (!error) {
    return (
      <>
        <h1 className="font-display text-display-lg text-ink">Checking your payment</h1>
        <p role="status" className="mt-6 flex items-center gap-3 text-sm text-ink-2">
          <Loader2 className="size-4 animate-spin text-violet" aria-hidden />
          {waiting ? "The payment provider is still confirming. Please keep this page open." : "Please keep this page open while Yard confirms the result."}
        </p>
      </>
    )
  }

  return (
    <>
      <h1 className="font-display text-display-lg text-ink">Payment not confirmed yet</h1>
      <p role="alert" className="mt-5 flex max-w-xl items-start gap-3 text-sm leading-relaxed text-ink-2">
        <WarningCircleIcon className="mt-0.5 size-5 shrink-0 text-amber-400" aria-hidden />
        {error}
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button variant="primary" onClick={() => { setFailure(null); setWaiting(false); setAttempt((value) => value + 1) }}>Retry check</Button>
        <Button asChild variant="secondary"><Link href="/you/orders">View your orders</Link></Button>
      </div>
    </>
  )
}
