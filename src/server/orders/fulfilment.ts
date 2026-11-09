import "server-only"
import { writeAudit } from "../audit"
import type { Tx } from "../db"
import { notFound, rule } from "../http/errors"
import { addEvent, announce, lockOrder, setMerchantStatus, updateState, type OrderActor } from "./core"

/** Moves a paid order into packing. Repeated requests are harmless; every other state is refused. */
export async function markProcessing(tx: Tx, input: { orderRefId: string; brandId: string; actor: OrderActor }) {
  const locked = await lockOrder(tx, input.orderRefId)
  if (!locked || locked.order.brandId !== input.brandId) throw notFound()
  const { order, state } = locked
  if (order.status === "processing" && state.fulfilmentStatus === "processing") return { orderId: order.id, alreadyProcessing: true }
  if (order.status !== "paid" || !["paid", "partially_refunded"].includes(state.paymentStatus) || state.fulfilmentStatus !== "unfulfilled") {
    throw rule("Only paid orders that haven't started fulfilment can move to processing.")
  }
  await setMerchantStatus(tx, order.id, "processing")
  await updateState(tx, order.id, { fulfilmentStatus: "processing" })
  await addEvent(tx, order.id, "fulfilment.processing", input.actor, {})
  await writeAudit({
    actor: { kind: "brand", id: input.actor.id, name: input.actor.name, role: input.actor.role },
    action: "order.processing_started",
    target: `Order ${order.reference}`,
    subjectType: "order_ref",
    subjectId: order.id,
    brandId: input.brandId,
    meta: { orderId: order.id },
  })
  await announce(order, "processing")
  return { orderId: order.id, alreadyProcessing: false }
}