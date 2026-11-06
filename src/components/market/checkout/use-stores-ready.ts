"use client"

import { useSyncExternalStore } from "react"
import { useCart } from "@/lib/stores/cart"
import { useOrders } from "@/lib/stores/orders"
import { useSaved } from "@/lib/stores/saved"
import { useSession } from "@/lib/stores/session"

/*
 * The bag, session, saves and orders are persisted and rehydrate after mount (Providers).
 * `useHydrated()` only says React has hydrated; the checkout needs to know the stores have
 * actually been read, or an empty first render would bounce a full bag back to /bag.
 */

const persisted = [useCart.persist, useSession.persist, useSaved.persist, useOrders.persist]

function subscribe(onChange: () => void) {
  const offs = persisted.map((p) => p.onFinishHydration(() => onChange()))
  return () => offs.forEach((off) => off())
}

const getSnapshot = () => persisted.every((p) => p.hasHydrated())
const getServerSnapshot = () => false

/** True once every persisted shopper store has been read from storage. False on the server. */
export function useStoresReady() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
