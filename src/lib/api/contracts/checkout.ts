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
    provider: "paystack" | "stub"
    status: string
    reference: string
    authorizationUrl: string | null
    accessCode: string | null
    publicKey: string | null
    stub: boolean
    message: string | null
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