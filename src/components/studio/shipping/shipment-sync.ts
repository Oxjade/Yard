"use client"

import { useEffect } from "react"
import { ApiError } from "@/lib/api/client"
import type { ShipmentEventBody } from "@/lib/api/contracts/shipping"
import { postShipmentEvent, studioDeliveryKey } from "@/lib/api/shipping"
import { revalidatePrefix } from "@/lib/api/use-api"
import { useServerSession } from "@/lib/session/use-server-session"

/**
 * Shipment events from Studio's browser-data order pages (§6.5). The order changes here first (as
 * it always has); then the event goes to the server, so the shopper's estimate and notification
 * follow. Posts that fail for a reason other than "not yours" wait in sessionStorage and go out on
 * the next signed-in load of an Orders page.
 */

const KEY = "nocturne-shipment-queue"
type Queued = { orderId: string; body: ShipmentEventBody; at: string }

function readQueue(): Queued[] {
  try {
    const raw = window.sessionStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as Queued[]) : []
    return Array.isArray(list) ? list.slice(0, 50) : []
  } catch {
    return []
  }
}

function writeQueue(list: Queued[]) {
  try {
    if (list.length) window.sessionStorage.setItem(KEY, JSON.stringify(list.slice(-50)))
    else window.sessionStorage.removeItem(KEY)
  } catch {
    // Storage blocked: the event stays in this browser only.
  }
}

export type SyncResult = "sent" | "signed_out" | "queued" | "not_on_server"

/** Sends one shipment event. `occurredAt` is stamped now, so a queued event keeps when it happened. */
export async function syncShipment(orderId: string, body: ShipmentEventBody, signedIn: boolean): Promise<SyncResult> {
  const stamped: ShipmentEventBody = { ...body, occurredAt: body.occurredAt ?? new Date().toISOString() }
  if (!signedIn) {
    writeQueue([...readQueue(), { orderId, body: stamped, at: new Date().toISOString() }])
    return "signed_out"
  }
  try {
    await postShipmentEvent(orderId, stamped)
    revalidatePrefix(studioDeliveryKey(orderId))
    return "sent"
  } catch (e) {
    // The server doesn't hold this order for this brand (another brand's session, or an order it never saw).
    if (e instanceof ApiError && (e.status === 404 || e.status === 403 || e.status === 400)) return "not_on_server"
    writeQueue([...readQueue(), { orderId, body: stamped, at: new Date().toISOString() }])
    return e instanceof ApiError && e.status === 401 ? "signed_out" : "queued"
  }
}

/** The toast line each result reads. */
export function syncMessage(r: SyncResult) {
  switch (r) {
    case "sent":
      return "The shopper's estimate updates too."
    case "signed_out":
      return "Tracking saved in this browser. Sign in to Brand Studio so the shopper's estimate updates too."
    case "queued":
      return "Saved in this browser. Yard sends it to the shopper's order once you're back online."
    case "not_on_server":
      return "Saved on the order in this browser."
  }
}

let flushing = false

/** Sends queued events once a brand session is ready (mounted on Studio's Orders pages). */
export function useShipmentQueue() {
  const ready = useServerSession((s) => s.status === "ready" && !!s.brand)
  useEffect(() => {
    if (!ready || flushing) return
    const queue = readQueue()
    if (!queue.length) return
    flushing = true
    void (async () => {
      const left: Queued[] = []
      for (const q of queue) {
        try {
          await postShipmentEvent(q.orderId, q.body)
          revalidatePrefix(studioDeliveryKey(q.orderId))
        } catch (e) {
          // Not ours, or refused as invalid: drop it. Anything else waits for the next load.
          if (!(e instanceof ApiError && (e.status === 404 || e.status === 403 || e.status === 400))) left.push(q)
        }
      }
      writeQueue(left)
      flushing = false
    })()
  }, [ready])
}
