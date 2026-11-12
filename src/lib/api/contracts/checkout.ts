export type StartCheckoutRequest = {
  idempotencyKey: string
  currency: string
  shipTo: {
    name: string
    line1: string
    line2?: string
    city: string
    region?: string
    postalCode?: string
    country: string
    phone?: string
  }
  shipping: { brandId: string; service: "standard" | "express" | "pickup" }[]
  expectedTotalMinor?: number
  /** How the shopper chose to pay; the provider's hosted page (Paystack or Bachs) offers that method. Card details are typed only there. */
  paymentMethod?: "card" | "bank_transfer" | "ussd" | "mobile_money"
}

export type CheckoutStartResponse = {
  id: string
  status: string
  reference: string | null
  currency: string
  subtotalMinor: number
  shippingMinor: number
  totalMinor: number
  orderIds: string[]
  groups: unknown
  createdAt: string
  expiresAt: string
  paidAt: string | null
  failureReason: string | null
  payment: {
    id: string
    provider: "paystack" | "bachs" | "stub"
    status: string
    reference: string
    authorizationUrl: string | null
    accessCode: string | null
    publicKey: string | null
    stub: boolean
    message: string | null
    /** How it was paid, as the provider reported it once paid ("card", "bank_transfer", "ussd"…). */
    channel: string | null
    /** Only on a verify answer while pending: Paystack's own status. "abandoned" = left without paying, nothing charged. */
    providerStatus?: string | null
  } | null
}

export type CheckoutOrderSummary = {
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
  states: { merchant: string; payment: string; fulfilment: string; return: string; dispute: string }
  service: string
}

export type CheckoutOrdersPage = { items: CheckoutOrderSummary[]; nextCursor: string | null }
/** GET /api/checkout/options: how this deployment takes payments. */
/** `provider`: whose hosted page takes the payment (absent from an older server: treat as Paystack). */
export type CheckoutOptions = { mode: "off" | "stub" | "test" | "live"; provider?: "paystack" | "bachs" | "stub" | "off"; currencies: string[] }
