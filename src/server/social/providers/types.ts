import "server-only"

/**
 * The one interface every social provider implements (§6.1): the live Instagram and TikTok
 * adapters (active only with Yard's platform keys; untested end to end in this sandbox) and the
 * development sandbox. Tokens never leave src/server/social/**.
 */
export type ProviderId = "instagram" | "tiktok"
export type ProviderMode = "live" | "sandbox"

export type TokenSet = {
  accessToken: string
  refreshToken?: string
  expiresAt?: Date
  refreshExpiresAt?: Date
  scopes: string[]
  externalUserId: string
}

export type RemoteMedia = { url: string; kind: "image" | "video"; posterUrl?: string; width?: number; height?: number; durationMs?: number }

export type RemotePost = {
  externalId: string
  kind: "image" | "video" | "carousel"
  caption: string
  permalink?: string
  embedUrl?: string
  postedAt: Date
  media: RemoteMedia[]
}

export type RemoteProfile = { externalUserId: string; handle: string; displayName: string; avatarUrl?: string; accountType?: string }

export interface SocialProvider {
  id: ProviderId
  mode: ProviderMode
  configured(): boolean
  authorizeUrl(i: { state: string; redirectUri: string; codeChallenge?: string }): string
  exchangeCode(i: { code: string; redirectUri: string; codeVerifier?: string }): Promise<TokenSet>
  refresh(t: TokenSet): Promise<TokenSet>
  revoke?(t: TokenSet): Promise<void>
  profile(t: TokenSet): Promise<RemoteProfile>
  listMedia(t: TokenSet, cursor?: string): Promise<{ items: RemotePost[]; next?: string }>
  /** When a token should be refreshed before use (Instagram: within 10 days; TikTok: within 1 h). */
  refreshWindowMs: number
  /** Whether PKCE is used on authorize (TikTok with TIKTOK_USE_PKCE). */
  usesPkce(): boolean
}

/**
 * A provider failure, classified so sync and the callback can set a safe status:
 * `auth` → needs_reauth; `permission` → error with a reconnect hint; `rate` → back off 1 h;
 * `other` → error. `detail` is user-facing copy and never carries a token or a raw API message.
 */
export class ProviderError extends Error {
  constructor(
    public kind: "auth" | "permission" | "rate" | "other",
    public detail: string,
    public code?: string,
  ) {
    super(`${kind}: ${detail}`)
    this.name = "ProviderError"
  }
}

/** fetch with a timeout and no redirects followed for API calls (the APIs never redirect). */
export async function providerFetch(url: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const { timeoutMs = 15_000, ...rest } = init
  try {
    return await fetch(url, { ...rest, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(timeoutMs) })
  } catch {
    // The message of a failed fetch can repeat the URL (and its query string): never pass it on.
    throw new ProviderError("other", "Yard couldn't reach the provider. Try again later.", "network")
  }
}

/** Reads a JSON body without trusting it to be JSON. */
export async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const v = (await res.json()) as unknown
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
