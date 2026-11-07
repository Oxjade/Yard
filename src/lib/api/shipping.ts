import { api } from "./client"
import type {
  ComplaintBody,
  ComplaintDto,
  DeliveryDto,
  EstimateDto,
  EstimateResponse,
  QuoteBody,
  QuoteResponse,
  RegisterOrderBody,
  RegisterResponse,
  ShipmentEventBody,
  ShipmentEventDto,
  ShippingProfileBody,
  StudioShippingDto,
} from "./contracts/shipping"

/** Typed calls for delivery estimates, quotes, orders and Studio shipping (cluster D, §6.5). */

export const estimateKey = (q: { product: string; to: string; city?: string | null; qty?: number; cur?: string; release?: string | null }) =>
  `shipping:estimate:${q.product}:${q.to}:${q.city ?? ""}:${q.qty ?? 1}:${q.cur ?? ""}:${q.release ?? ""}`

export function getEstimate(q: { product: string; to: string; city?: string | null; qty?: number; cur?: string; release?: string | null }) {
  return api<EstimateResponse>("/api/shipping/estimate", { query: { product: q.product, to: q.to, city: q.city ?? undefined, qty: q.qty, cur: q.cur, release: q.release ?? undefined } })
}

export function postQuote(body: QuoteBody) {
  return api<QuoteResponse>("/api/shipping/quote", { body })
}

export function registerOrders(body: RegisterOrderBody) {
  return api<RegisterResponse>("/api/orders/register", { body })
}

export const deliveryKey = (orderId: string) => `shipping:delivery:${orderId}`
export function getOrderDelivery(orderId: string) {
  return api<DeliveryDto>(`/api/orders/${encodeURIComponent(orderId)}/delivery`)
}

export function fileComplaint(orderId: string, body: ComplaintBody) {
  return api<ComplaintDto>(`/api/orders/${encodeURIComponent(orderId)}/delivery-complaints`, { body })
}

export const STUDIO_SHIPPING_KEY = "studio:shipping"
export function getStudioShipping() {
  return api<StudioShippingDto>("/api/studio/shipping")
}
export function saveStudioShipping(body: ShippingProfileBody) {
  return api<StudioShippingDto>("/api/studio/shipping", { method: "PUT", body })
}

export const studioDeliveryKey = (orderId: string) => `studio:delivery:${orderId}`
export function getStudioOrderDelivery(orderId: string) {
  return api<DeliveryDto>(`/api/studio/orders/${encodeURIComponent(orderId)}/delivery`)
}

export function postShipmentEvent(orderId: string, body: ShipmentEventBody) {
  return api<{ event: ShipmentEventDto; estimate: EstimateDto; delivery: DeliveryDto }>(`/api/studio/orders/${encodeURIComponent(orderId)}/shipment`, { body })
}

export function respondToComplaint(orderId: string, message: string) {
  return api<{ complaint: ComplaintDto }>(`/api/studio/orders/${encodeURIComponent(orderId)}/complaint-response`, { body: { message } })
}
