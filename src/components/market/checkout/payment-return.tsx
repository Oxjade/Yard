"use client"

import { useEffect } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"

/**
 * The old payment return (/checkout/confirm?checkout={id}). Paystack now returns shoppers straight
 * to /checkout/confirmation?group={id}&paid=1; payments started before that change (and saved
 * links) still land here and are sent on, where the confirmation verifies and follows the server.
 */
export function PaymentReturn() {
  const params = useSearchParams()
  const router = useRouter()
  const checkoutId = params.get("checkout")

  useEffect(() => {
    if (checkoutId) router.replace(`/checkout/confirmation?group=${encodeURIComponent(checkoutId)}&paid=1`)
  }, [checkoutId, router])

  if (checkoutId) return null
  return (
    <>
      <h1 className="font-display text-display-lg text-ink">Payment link incomplete</h1>
      <p role="alert" className="mt-5 max-w-xl text-sm leading-relaxed text-ink-2">
        This payment link is missing its checkout reference. Every order you placed is in Your orders.
      </p>
      <div className="mt-6">
        <Button asChild variant="primary">
          <Link href="/you/orders">View your orders</Link>
        </Button>
      </div>
    </>
  )
}
