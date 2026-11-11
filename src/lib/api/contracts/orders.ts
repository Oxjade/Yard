export type OrderSummaryDto = {
  id: string
  reference: string
  groupReference: string
  checkoutId: string | null
  brand: { id: string; name: string; handle: string }
  customerName: string
  shipToPreview: { city: string | null; country: string }
  placedAt: string
  currency: string
  subtotalMinor: number
  shippingMinor: number
  totalMinor: number
  refundedMinor: number
  itemCount: number
  previewItems: { productId: string; variantId: string; name: string; qty: number; unitMinor: number }[]
  states: { merchant: string; payment: string; fulfilment: string; return: string; dispute: string }
  service: string
}

export type OrdersPageDto = {
  items: OrderSummaryDto[]
  nextCursor: string | null
  /** GET /api/orders, first page only: totals over all the shopper's orders (checkouts, orders shipped now). */
  counts?: { checkouts: number; shipped: number }
}

export type OrderDetailDto = OrderSummaryDto & {
  lines: { id: string; variantId: string; productId: string; title: string; qty: number; unitMinor: number; returnedQty: number; restockedQty: number; variantLabel: string; image: { src: string; alt: string; width: number; height: number } }[]
  shipTo: Record<string, unknown> | null
  paidAt: string | null
  cancelledAt: string | null
  cancelReason: string | null
  deliveredAt: string | null
  completedAt: string | null
  refundableMinor: number
  returns: { id: string; status: string; reason: string; reasonLabel: string; note: string; lines: { orderLineId: string; variantId: string; title: string; qty: number }[]; requestedAt: string; decidedAt: string | null; decidedBy: "brand" | "platform" | null; decisionReason: string | null }[]
  refunds: { id: string; kind: string; status: string; amountMinor: number; currency: string; reason: string; createdAt: string; settledAt: string | null; returnId: string | null }[]
  timeline: { id: string; kind: string; actorKind: string; at: string; data: Record<string, unknown> }[]
  actions: { canCancel: boolean; canRequestReturn: boolean; returnWindowEndsAt: string | null }
}
/** GET /api/studio/overview?days=: the Studio Overview for a real brand (server data only). */
export type StudioOverviewDto = {
  days: 7 | 30 | 90
  /** The brand's own currency (its prices and orders are in it). */
  currency: string
  /** Captured orders per currency: the window and the window before it. Net = gross - refunded. */
  sales: { currency: string; orders: number; grossMinor: number; refundedMinor: number; prevOrders: number; prevGrossMinor: number; prevRefundedMinor: number }[]
  /** Merchant status Paid or Processing: the Orders page's work not yet shipped. */
  toShip: { total: number; paid: number; processing: number }
  recentOrders: OrderSummaryDto[]
  topProducts: { productId: string; title: string; currency: string; units: number; revenueMinor: number; image: { src: string; alt: string } | null }[]
}
