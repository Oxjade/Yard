import "server-only"
import { ProviderNotConfigured, type ShippingProvider } from "./types"

/**
 * The shape a carrier integration takes (§6.5). Not connected in this build: `isConfigured()` is
 * false and every method throws, so `getProvider()` falls back to manual rates and nothing here
 * ever reaches a shopper.
 *
 * To connect a real carrier:
 * - Keys: read `<CARRIER>_API_KEY` and `<CARRIER>_ACCOUNT` through getEnv() (server-only; never
 *   NEXT_PUBLIC_). `isConfigured()` returns true only when both are present and valid.
 * - Methods: map the brand's services to the carrier's products (standard → economy/ground,
 *   express → express/priority). Pickup stays with the manual provider (it's the brand's own store).
 * - quote(): call the carrier's rate API outside any DB transaction (§1.3) with origin, destination
 *   and parcel weight; return QuoteOption[] in the brand's currency with transit in business days.
 * - track(): poll or receive tracking updates and map them to CarrierEvent; they are stored as
 *   shipment_events with source 'carrier' and trigger shipping.recompute().
 * - Webhook: POST /api/shipping/carriers/[id]/webhook (not created in this build) verifies the
 *   carrier's signature, maps the payload to CarrierEvent and records it, idempotent per event id.
 * - createShipment(): buys a label and returns the tracking number and label URL.
 * - guaranteedDates: only a carrier that contractually guarantees a delivery date sets this
 *   capability and returns `guaranteed: true` with a date. Yard shows an exact date only then;
 *   every other estimate stays a range labelled as an estimate.
 */
export const carrierStubProvider: ShippingProvider = {
  id: "carrier:stub",
  label: "Carrier integration (not connected)",
  kind: "carrier",
  capabilities: { rates: true, estimates: true, tracking: true, labels: true, guaranteedDates: false },
  isConfigured: () => false,
  async quote() {
    throw new ProviderNotConfigured("carrier:stub")
  },
  async track() {
    throw new ProviderNotConfigured("carrier:stub")
  },
  async createShipment() {
    throw new ProviderNotConfigured("carrier:stub")
  },
}
