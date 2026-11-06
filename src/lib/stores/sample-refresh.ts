import type { MerchantOrder } from "@/lib/data/types"
import { currentReferences } from "./old-name"

/**
 * A sample order saved in this browser before the sample data was corrected (addresses and
 * carriers that match the shipping country, no drop pieces ordered before their release, brand
 * codes in references). It takes the corrected sample's reference, address and, while nothing has
 * been recorded against them, its lines and amounts. What happened to it here (status, payment,
 * timeline, tracking someone entered, a return and its decision, a cancellation) stays as saved.
 */
export function refreshSampleOrder(saved: MerchantOrder, sample: MerchantOrder | undefined): MerchantOrder {
  if (!sample) return { ...saved, reference: currentReferences(saved.reference) }
  // A return request or a refund names these lines and amounts, so they stay as they were.
  const settled = !!(saved.returnRequest || saved.refund)
  // Tracking the sample came with (same number) takes the corrected carrier; tracking entered here stays.
  const sampleTracking = !!saved.tracking && !!sample.tracking && saved.tracking.number === sample.tracking.number
  return {
    ...saved,
    reference: sample.reference,
    shippingAddress: sample.shippingAddress,
    shippingMethod: sample.shippingMethod,
    ...(settled ? {} : { lines: sample.lines, subtotal: sample.subtotal, shipping: sample.shipping, tax: sample.tax, total: sample.total, commission: sample.commission }),
    tracking: sampleTracking ? { ...saved.tracking!, carrier: sample.tracking!.carrier } : saved.tracking,
  }
}
