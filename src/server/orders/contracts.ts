import { z } from "zod"
import { isoDateTime, safeId, safeLine, safeText } from "@/lib/api/contracts/common"
import { DISPUTE_STATES, RETURN_REASONS } from "../db/schema/orders-v3"

/**
 * ORDERS v3 request bodies and response shapes. No server-only: the frontend may import the
 * types (and the schemas to validate forms). Bodies are strict, so a client can't slip in a
 * brandId, customerId, amount it shouldn't choose, or status.
 */

const idemKey = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/, { error: "Send an idempotency key of 8–80 letters, digits, - or _." })
const qty = z.number().int().min(1).max(999)
const minor = z.number().int().min(1).max(1_000_000_000_000)

export const returnReasonLabels: Record<(typeof RETURN_REASONS)[number], string> = {
  too_small: "Too small",
  too_large: "Too large",
  not_as_described: "Not as described",
  damaged: "Arrived damaged or faulty",
  wrong_item: "Wrong item sent",
  unwanted: "Changed my mind",
  other: "Something else",
}

/* ---------- Shopper ---------- */

export const ordersListQuery = z.object({
  /** ISO time: orders placed before this (the previous page's nextCursor). */
  before: isoDateTime.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

export const cancelOrderBody = z
  .object({
    reason: safeLine({ max: 200 }).optional(),
    idempotencyKey: idemKey,
  })
  .strict()

export const returnRequestBody = z
  .object({
    /** Lines coming back; omit for the whole order. */
    lines: z
      .array(z.object({ variantId: safeId(), qty }).strict())
      .min(1)
      .max(100)
      .optional(),
    reason: z.enum(RETURN_REASONS),
    note: safeText({ max: 1000 }).default(""),
    idempotencyKey: idemKey,
  })
  .strict()

/* ---------- Brand (Studio) ---------- */

export const brandOrdersQuery = z.object({
  before: isoDateTime.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  payment: z.enum(["pending", "paid", "failed", "partially_refunded", "refunded"]).optional(),
  fulfilment: z.enum(["unfulfilled", "processing", "shipped", "delivered", "returned_to_sender", "cancelled"]).optional(),
  returns: z.enum(["open", "any"]).optional(),
  q: safeLine({ max: 60 }).optional(),
})

export const brandCancelBody = z
  .object({
    reason: safeLine({ max: 200 }).pipe(z.string().trim().min(3, { error: "Tell the shopper why (a few words)." })),
    restock: z.boolean().default(true),
    idempotencyKey: idemKey,
  })
  .strict()

export const returnDecisionBody = z
  .object({
    decision: z.enum(["approve", "reject"]),
    /** Required to reject: shown to the shopper. */
    reason: safeLine({ max: 300 }).optional(),
  })
  .strict()
  .refine((b) => b.decision === "approve" || (b.reason && b.reason.trim().length >= 3), { path: ["reason"], error: "Tell the shopper why you're declining." })

export const returnReceiveBody = z
  .object({
    restock: z.boolean().default(true),
    /** Default true: refund what came back as soon as it's received. */
    refund: z.boolean().default(true),
    /** A lower refund than the computed one (e.g. an item came back worn). Never more. */
    amountMinor: minor.optional(),
    idempotencyKey: idemKey,
  })
  .strict()

export const refundBody = z
  .object({
    amountMinor: minor,
    reason: safeLine({ max: 200 }).pipe(z.string().min(3, { error: "Say what the refund is for." })),
    idempotencyKey: idemKey,
  })
  .strict()

export const disputeEvidenceBody = z
  .object({
    evidence: safeText({ max: 4000 }).pipe(z.string().min(10, { error: "Describe what happened with this order (tracking, messages, proof of delivery)." })),
  })
  .strict()

/* ---------- Admin ---------- */

export const adminDisputesQuery = z.object({
  status: z.enum(DISPUTE_STATES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export const adminDisputeUpdateBody = z
  .object({
    adminNote: safeText({ max: 2000 }).optional(),
    responseSubmitted: z.boolean().optional(),
    status: z.enum(["under_review", "closed"]).optional(),
  })
  .strict()

export const adminReturnDecisionBody = z
  .object({
    decision: z.enum(["approve", "reject"]),
    reason: safeLine({ max: 300 }).pipe(z.string().min(3, { error: "Record why Yard decided this." })),
  })
  .strict()

/* ---------- Response shapes ---------- */

export type MoneyDto = { amountMinor: number; currency: string }

export type OrderLineDto = { id: string; variantId: string; productId: string; title: string; qty: number; unitMinor: number; returnedQty: number; restockedQty: number }

export type OrderStatesDto = {
  merchant: string
  payment: string
  fulfilment: string
  return: string
  dispute: string
}

export type OrderEventDto = { id: string; kind: string; actorKind: string; at: string; data: Record<string, unknown> }

export type ReturnDto = {
  id: string
  status: string
  reason: string
  reasonLabel: string
  note: string
  lines: { orderLineId: string; variantId: string; title: string; qty: number }[]
  requestedAt: string
  decidedAt: string | null
  decidedBy: "brand" | "platform" | null
  decisionReason: string | null
  receivedAt: string | null
  refundId: string | null
}

export type RefundDto = { id: string; kind: string; status: string; amountMinor: number; currency: string; reason: string; createdAt: string; settledAt: string | null; returnId: string | null }

export type DisputeDto = {
  id: string
  status: string
  category: string | null
  amountMinor: number
  currency: string
  evidenceDueAt: string | null
  brandEvidence: string | null
  brandEvidenceAt: string | null
  responseSubmittedAt: string | null
  openedAt: string
  resolvedAt: string | null
}

export type OrderSummaryDto = {
  id: string
  reference: string
  groupReference: string
  checkoutId: string | null
  brand: { id: string; name: string; handle: string }
  placedAt: string
  currency: string
  subtotalMinor: number
  shippingMinor: number
  totalMinor: number
  refundedMinor: number
  itemCount: number
  states: OrderStatesDto
  service: string
}

export type OrderActionsDto = {
  canCancel: boolean
  canRequestReturn: boolean
  returnWindowEndsAt: string | null
}

export type OrderDetailDto = OrderSummaryDto & {
  lines: OrderLineDto[]
  shipTo: Record<string, unknown> | null
  paidAt: string | null
  cancelledAt: string | null
  cancelReason: string | null
  deliveredAt: string | null
  completedAt: string | null
  refundableMinor: number
  returns: ReturnDto[]
  refunds: RefundDto[]
  disputes: DisputeDto[]
  timeline: OrderEventDto[]
  actions: OrderActionsDto
  /** Shipping's delivery view (estimate, shipment events, complaint), read as the viewer. */
  delivery: unknown
}

export type OrdersPageDto<T> = { items: T[]; nextCursor: string | null }
