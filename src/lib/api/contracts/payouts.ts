/** Response shapes for the Studio payout endpoints. Amounts are minor units. */

export type BrandBalanceDto = {
  currency: string
  pendingMinor: number
  availableMinor: number
  reserveMinor: number
  inPayoutMinor: number
}

export type PayoutDto = {
  id: string
  brandId: string
  brandName?: string
  currency: string
  amountMinor: number
  status: string
  requestedAt: string
  approvedAt: string | null
  sentAt: string | null
  paidAt: string | null
  failedAt: string | null
  closedAt: string | null
  batchId: string | null
  providerRef: string | null
  stubRecipient: boolean
  lastError: string | null
  rejectReason: string | null
  approvals: { adminId: string; adminName: string; step: number; at: string; note: string | null }[]
}

export type PayoutAccountDto = {
  country: string
  currency: string
  bankCode: string
  bankName: string
  accountName: string
  accountLast4: string
  recipientProvider: "stub" | "paystack"
  verified: boolean
  changedAt: string
  cooldownUntil: string | null
}

export type PayoutRulesDto = {
  tier: string
  reserveBps: number
  reserveDays: number
  commissionBps: number
  minPayoutMinor: number
  onHold: boolean
  holdReason: string | null
  cooldownUntil: string | null
}

export type PayoutSummaryDto = {
  currency: string
  /**
   * How approved payouts reach the brand: "manual" (Bachs: Yard pays the bank account by transfer
   * and records it), "provider" (Paystack transfers) or "test" (stub or payments off: nothing is paid).
   */
  payoutMethod?: "manual" | "provider" | "test"
  balances: BrandBalanceDto[]
  account: PayoutAccountDto | null
  payouts: PayoutDto[]
  rules: PayoutRulesDto
}

export type StatementEntryDto = {
  id: string
  transactionId: string
  at: string
  kind: string
  memo: string | null
  account: string
  direction: "debit" | "credit"
  amountMinor: number
  signedMinor: number
  currency: string
  orderId: string | null
  payoutId: string | null
  refundId: string | null
}

export type PayoutStatementDto = { entries: StatementEntryDto[]; nextBefore: string | null }
