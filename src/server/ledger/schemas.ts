import { z } from "zod"
import { safeId, safeLine, safeText } from "@/lib/api/contracts/common"

/** Request contracts for the payout and finance routes (strict: unknown fields are a 400). */
const currency = z.string().regex(/^[A-Z]{3}$/, { error: "Use a 3-letter currency code." })
const minor = z.number().int({ error: "Use a whole amount in minor units." }).positive({ error: "Use an amount above zero." }).max(Number.MAX_SAFE_INTEGER)
const idemKey = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/, { error: "Send an idempotency key (8–80 letters, digits, - or _)." })
const before = z.iso.datetime({ error: "Use an ISO timestamp." }).transform((s) => new Date(s)).optional()
const limit = z.coerce.number().int().min(1).max(200).optional()

export const requestPayoutBody = z.strictObject({ amountMinor: minor, currency: currency.optional(), idempotencyKey: idemKey })

export const payoutAccountBody = z.strictObject({
  country: z.string().regex(/^[A-Z]{2}$/, { error: "Use a 2-letter country code." }),
  currency,
  bankCode: z.string().regex(/^[A-Za-z0-9-]{2,20}$/, { error: "Choose your bank." }),
  bankName: safeLine({ max: 80 }).pipe(z.string().min(2)),
  accountName: safeLine({ max: 100 }).pipe(z.string().min(2)),
  accountNumber: z.string().regex(/^[0-9]{6,20}$/, { error: "Use the account number, digits only." }),
})

export const statementQuery = z.strictObject({ currency: currency.optional(), account: z.enum(["brand_pending", "brand_available", "brand_reserve", "brand_payout_hold"]).optional(), before, limit })

export const adminPayoutsQuery = z.strictObject({
  status: z.array(z.enum(["requested", "awaiting_second_approval", "approved", "sending", "processing", "paid", "failed", "rejected", "cancelled"])).optional(),
  brandId: safeId().optional(),
  before: z.iso.datetime().transform((s) => new Date(s)).optional(),
  limit,
})

export const approveBody = z.strictObject({ note: safeText({ max: 500 }).optional() })
export const rejectBody = z.strictObject({ reason: safeText({ max: 500 }).pipe(z.string().trim().min(3, { error: "Say why." })) })
export const createBatchBody = z.strictObject({ currency, payoutIds: z.array(safeId()).max(500).optional() })
export const resolveBody = z.strictObject({ note: safeText({ max: 500 }).pipe(z.string().trim().min(3, { error: "Say how it was resolved." })) })

export const brandSettingsBody = z.strictObject({
  tierOverride: z.enum(["new", "standard", "trusted"]).nullable().optional(),
  commissionBpsOverride: z.number().int().min(0).max(5000).nullable().optional(),
  payoutsOnHold: z.boolean().optional(),
  holdReason: safeText({ max: 300 }).nullable().optional(),
})

export const ledgerQuery = z.strictObject({
  brandId: safeId().optional(),
  currency: currency.optional(),
  account: z.enum(["brand_pending", "brand_available", "brand_reserve", "brand_payout_hold", "platform_commission", "platform_adjustments", "provider_clearing"]).optional(),
  before: z.iso.datetime().transform((s) => new Date(s)).optional(),
  limit,
})

export const adjustmentBody = z.strictObject({
  brandId: safeId(),
  currency,
  account: z.enum(["brand_available", "brand_reserve", "brand_pending"]),
  direction: z.enum(["credit", "debit"]),
  amountMinor: minor,
  reason: safeText({ max: 500 }).pipe(z.string().trim().min(3, { error: "Say why." })),
  idempotencyKey: idemKey,
})
