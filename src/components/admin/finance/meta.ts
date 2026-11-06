import type { Dispute, Payout, Refund, ReconciliationRow, Transaction } from "@/lib/data/admin"
import type { AdjustmentRequest } from "@/lib/stores/admin"

/** Labels and badge tones for orders and finance. Acid = needs a decision; purple = in motion. */

export type Tone = "neutral" | "info" | "attention" | "success" | "danger" | "muted"
export type Meta = { label: string; tone: Tone }

export type PayState = "paid" | "pending" | "failed" | "refund_requested" | "refund_approved" | "refunded" | "disputed" | "charged_back"
export type FulfilState = "unfulfilled" | "on_hold" | "processing" | "shipped" | "delivered" | "cancelled"

export const payMeta: Record<PayState, Meta> = {
  paid: { label: "Paid", tone: "success" },
  pending: { label: "Awaiting payment", tone: "muted" },
  failed: { label: "Charge failed", tone: "danger" },
  refund_requested: { label: "Refund requested", tone: "attention" },
  refund_approved: { label: "Refund approved", tone: "info" },
  refunded: { label: "Refunded", tone: "muted" },
  disputed: { label: "Disputed", tone: "attention" },
  charged_back: { label: "Charged back", tone: "danger" },
}

export const fulfilMeta: Record<FulfilState, Meta> = {
  unfulfilled: { label: "Unfulfilled", tone: "attention" },
  /** Not shipped and not to be shipped: the charge failed, or a dispute is open on an order that hasn't left. */
  on_hold: { label: "On hold", tone: "muted" },
  processing: { label: "Processing", tone: "info" },
  shipped: { label: "Shipped", tone: "info" },
  delivered: { label: "Delivered", tone: "success" },
  cancelled: { label: "Cancelled", tone: "muted" },
}

export type GroupState = "confirmed" | "partially_shipped" | "shipped" | "delivered" | "refunded" | "cancelled"

export const groupMeta: Record<GroupState, Meta> = {
  confirmed: { label: "Confirmed", tone: "neutral" },
  partially_shipped: { label: "Partially shipped", tone: "info" },
  shipped: { label: "Shipped", tone: "info" },
  delivered: { label: "Delivered", tone: "success" },
  refunded: { label: "Refunded", tone: "muted" },
  cancelled: { label: "Cancelled", tone: "muted" },
}

export const txTypeLabel: Record<Transaction["type"], string> = {
  charge: "Charge",
  refund: "Refund",
  payout: "Payout",
  commission: "Commission",
  adjustment: "Adjustment",
  chargeback: "Chargeback",
}

export const txStatusMeta: Record<Transaction["status"], Meta> = {
  succeeded: { label: "Completed", tone: "success" },
  pending: { label: "Pending", tone: "info" },
  failed: { label: "Failed", tone: "danger" },
}

/** A transaction's status as Finance reads it: a completed chargeback is money taken back, so it reads Reversed. */
export function txStatus(t: Pick<Transaction, "status"> & { type: Transaction["type"] }): Meta {
  if (t.type === "chargeback" && t.status === "succeeded") return { label: "Reversed", tone: "danger" }
  return txStatusMeta[t.status]
}

export const payoutMeta: Record<Payout["status"], Meta> = {
  awaiting_approval: { label: "Awaiting approval", tone: "attention" },
  held: { label: "Held", tone: "danger" },
  scheduled: { label: "Scheduled", tone: "neutral" },
  processing: { label: "Processing", tone: "info" },
  paid: { label: "Completed", tone: "success" },
}

export const refundMeta: Record<Refund["status"], Meta> = {
  requested: { label: "Requested", tone: "attention" },
  approved: { label: "Approved", tone: "info" },
  issued: { label: "Completed", tone: "success" },
  declined: { label: "Declined", tone: "muted" },
}

export type DisputeStage = Dispute["stage"] | "evidence_submitted"

export const disputeMeta: Record<DisputeStage, Meta> = {
  needs_evidence: { label: "Needs evidence", tone: "attention" },
  evidence_submitted: { label: "Evidence saved", tone: "info" },
  under_review: { label: "Under review", tone: "info" },
  won: { label: "Won", tone: "success" },
  lost: { label: "Lost", tone: "danger" },
}

export const reconMeta: Record<ReconciliationRow["status"], Meta> = {
  matched: { label: "Matched", tone: "success" },
  mismatch: { label: "Mismatch", tone: "danger" },
  pending: { label: "Awaiting report", tone: "muted" },
}

export const adjustmentMeta: Record<AdjustmentRequest["status"], Meta> = {
  pending: { label: "Awaiting second approver", tone: "attention" },
  approved: { label: "Approved and posted", tone: "success" },
  rejected: { label: "Rejected", tone: "muted" },
}
