import "server-only"
import { getEnv } from "../../env"
import { instagramProvider } from "./instagram"
import { sandboxProvider } from "./sandbox"
import { tiktokProvider } from "./tiktok"
import type { ProviderId, ProviderMode, SocialProvider } from "./types"

export type { ProviderId, ProviderMode, SocialProvider, TokenSet, RemotePost, RemoteMedia, RemoteProfile } from "./types"
export { ProviderError } from "./types"

/** The provider behind an account or a connect: live adapters, or the development sandbox. */
export function getProvider(id: ProviderId, mode: ProviderMode, brandId: string): SocialProvider {
  if (mode === "sandbox") return sandboxProvider(id, brandId)
  return id === "instagram" ? instagramProvider() : tiktokProvider()
}

/** Whether Yard's platform keys for a provider are set (§1.2). */
export function liveConfigured(id: ProviderId) {
  const env = getEnv()
  return id === "instagram" ? env.instagram.configured : env.tiktok.configured
}

/** The fixed redirect URI registered with each provider (§5.5). */
export function redirectUri(id: ProviderId) {
  return `${getEnv().publicUrl}/api/social/${id}/callback`
}

export const PROVIDERS: ProviderId[] = ["instagram", "tiktok"]
export const isProvider = (v: string): v is ProviderId => v === "instagram" || v === "tiktok"
