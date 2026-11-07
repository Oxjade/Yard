"use client"

import { useEffect } from "react"
import { toast } from "sonner"
import { ApiError } from "@/lib/api/client"
import type { ShipmentEventBody } from "@/lib/api/contracts/shipping"
import { postShipmentEvent, studioDeliveryKey } from "@/lib/api/shipping"
import { revalidatePrefix } from "@/lib/api/use-api"
import { getServerSessionState, identityKeyFor, useIdentityKey, useServerSession } from "@/lib/session/use-server-session"

/**
 * Shipment events from Studio's browser-data order pages (§6.5). The order changes here first (as
 * it always has); then the event goes to the server, so the shopper's estimate and notification
 * follow.
 * - Signed out: nothing is queued. The member signs in and saves again (the toast says so), so an
 *   event can never go out under whoever signs in next.
 * - A post that fails on the network (or a 5xx / 429) waits in sessionStorage with the identity
 *   that made it (member and brand), and goes out only while that same identity is signed in.
 *   Items for any other identity are dropped, with a toast, when the identity changes.
 * - "Not yours" (403/404), invalid (400) or refused by a rule (422) is never queued.
 */

const KEY = "nocturne-shipment-queue"
type Queued = { orderId: string; body: ShipmentEventBody; at: string; identity: string }

function readQueue(): Queued[] {
  try {
    const raw = window.sessionStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as Queued[]) : []
    // Items from before identities were recorded can't be attributed: they're dropped.
    return Array.isArray(list) ? list.filter((q) => q && typeof q.identity === "string" && q.identity.startsWith("studio:")).slice(0, 50) : []
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

export type SyncResult = "sent" | "signed_out" | "queued" | "not_on_server" | "refused"
export type SyncOutcome = { result: SyncResult; message?: string }

/** Sends one shipment event. `occurredAt` is stamped now, so a queued event keeps when it happened. */
export async function syncShipment(orderId: string, body: ShipmentEventBody, signedIn: boolean, opts: { queue?: boolean } = {}): Promise<SyncOutcome> {
  const stamped: ShipmentEventBody = { ...body, occurredAt: body.occurredAt ?? new Date().toISOString() }
  const identity = identityKeyFor("studio", getServerSessionState())
  if (!signedIn || !identity) return { result: "signed_out" }
  try {
    await postShipmentEvent(orderId, stamped)
    revalidatePrefix(studioDeliveryKey(orderId))
    return { result: "sent" }
  } catch (e) {
    if (e instanceof ApiError) {
      // A rule the server enforces (unpaid, already delivered, cancelled): its sentence says why.
      if (e.status === 422) return { result: "refused", message: e.message }
      // The server doesn't hold this order for this brand (another brand's session, or an order it never saw).
      if (e.status === 404 || e.status === 403 || e.status === 400) return { result: "not_on_server" }
      // The session ended: not queued under an identity that's gone.
      if (e.status === 401) return { result: "signed_out" }
    }
    // A form that shows its own error (Report a delay) retries itself instead of queueing.
    if (opts.queue === false) throw e
    writeQueue([...readQueue(), { orderId, body: stamped, at: new Date().toISOString(), identity }])
    return { result: "queued" }
  }
}

/** The toast line each result reads. */
export function syncMessage(r: SyncResult) {
  switch (r) {
    case "sent":
      return "The shopper's estimate updates too."
    case "signed_out":
      return "Tracking saved in this browser. Sign in to Brand Studio and save it again so the shopper's estimate updates too."
    case "queued":
      return "Saved in this browser. Yard sends it to the shopper's order once you're back online."
    case "not_on_server":
      return "Saved on the order in this browser."
    case "refused":
      return "Saved on the order in this browser only."
  }
}

let flushing = false

/** Sends queued events once the identity that queued them is signed in (mounted on Studio's order pages). */
export function useShipmentQueue() {
  const identity = useIdentityKey("studio")
  // Once the session store has answered (signed in or not), so the queue is sorted by identity.
  const ready = useServerSession((s) => s.status === "ready")
  useEffect(() => {
    if (!ready || flushing) return
    const queue = readQueue()
    if (!queue.length) return
    const mine = identity ? queue.filter((q) => q.identity === identity) : []
    const others = queue.filter((q) => q.identity !== identity)
    if (others.length) {
      // Another member or brand made these: they're never sent as this one.
      toast.warning(`${others.length === 1 ? "A shipment update" : `${others.length} shipment updates`} saved by another Studio account weren't sent`, {
        description: "They stay on the orders in this browser. Sign in as that account and save them again to update the shoppers' estimates.",
      })
    }
    if (!mine.length) {
      writeQueue([])
      return
    }
    flushing = true
    void (async () => {
      const left: Queued[] = []
      for (const q of mine) {
        try {
          await postShipmentEvent(q.orderId, q.body)
          revalidatePrefix(studioDeliveryKey(q.orderId))
        } catch (e) {
          // Not ours, refused by a rule, invalid, or signed out since: drop it. Anything else waits.
          if (!(e instanceof ApiError && [400, 401, 403, 404, 422].includes(e.status))) left.push(q)
        }
      }
      // Only this identity's items remain; anything another identity queued was dropped above.
      writeQueue(left)
      flushing = false
    })()
  }, [ready, identity])
}
