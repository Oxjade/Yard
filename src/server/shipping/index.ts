import "server-only"
import { NotImplemented } from "../http/errors"

/** Shipping contract (F1 draft; cluster D replaces the bodies and IMPL in wave 2). */
export const IMPL: string = "stub"

/** Hourly: marks orders past their ship-by or arrival dates late and notifies (§6.5). */
export async function checkLate(): Promise<void> {
  throw new NotImplemented("shipping.checkLate")
}

/** Recomputes an order's delivery estimate after a shipment event or profile change. */
export async function recompute(orderRefId: string, reason: string): Promise<void> {
  void orderRefId
  void reason
  throw new NotImplemented("shipping.recompute")
}

export const jobs = { checkLate }
