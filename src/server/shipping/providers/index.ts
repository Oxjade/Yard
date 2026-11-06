import "server-only"
import { carrierStubProvider } from "./carrier-stub"
import { manualProvider } from "./manual"
import type { ShippingProvider } from "./types"

export * from "./types"
export { manualProvider, zoneFor, tierFor, freeThreshold } from "./manual"
export { carrierStubProvider } from "./carrier-stub"

const registry: Record<string, ShippingProvider> = { [manualProvider.id]: manualProvider, [carrierStubProvider.id]: carrierStubProvider }

/** The brand's chosen provider, or manual rates when that one isn't configured (§6.5). */
export function getProvider(id: string | null | undefined): ShippingProvider {
  const p = id ? registry[id] : undefined
  return p && p.isConfigured() ? p : manualProvider
}

/** Carrier integrations Studio lists (none connected in this build). */
export function carrierProviders() {
  return Object.values(registry).filter((p) => p.kind === "carrier")
}
