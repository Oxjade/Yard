"use client"

import type { DeliveryDto } from "@/lib/api/contracts/shipping"
import { isNotFound } from "@/lib/api/errors"
import { getStudioOrderDelivery, studioDeliveryKey } from "@/lib/api/shipping"
import { useApi } from "@/lib/api/use-api"
import { useRealtimeEvent, useRealtimeStatus } from "@/lib/realtime/use-realtime"
import { useServerSession } from "@/lib/session/use-server-session"

/**
 * Yard's delivery record for one of the active brand's orders (GET /api/studio/orders/{id}/delivery):
 * the estimate, shipment events and any delivery problem. Follows `order.estimate` events on the
 * brand's stream; re-reads every 30 s while live updates are off. Signed out, there's nothing to
 * read (`signedIn: false`); another brand's order (or one the server never saw) is `notOnServer`.
 */
export function useStudioDelivery(orderId: string) {
  const session = useServerSession()
  const signedIn = session.status === "ready" && !!session.brand
  const status = useRealtimeStatus()
  const q = useApi<DeliveryDto>(signedIn ? studioDeliveryKey(orderId) : null, () => getStudioOrderDelivery(orderId), { refreshInterval: status === "open" ? undefined : 30_000 })
  useRealtimeEvent("order.estimate", (p) => {
    if (p.orderId === orderId) void q.revalidate()
  })
  const notOnServer = !q.data && isNotFound(q.error)
  return {
    data: q.data,
    sessionLoading: session.status === "loading",
    signedIn,
    sessionBrand: session.brand?.brand ?? null,
    canFulfil: !!session.brand?.permissions.includes("orders.fulfil"),
    isLoading: signedIn && q.isLoading,
    error: q.data || notOnServer ? undefined : q.error,
    notOnServer,
    retry: () => void q.revalidate(),
    retrying: q.isValidating,
    mutate: q.mutate,
  }
}
