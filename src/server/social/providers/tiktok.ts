import "server-only"
import { getEnv } from "../../env"
import { ProviderError, providerFetch, readJson, type RemotePost, type SocialProvider, type TokenSet } from "./types"

/**
 * TikTok "Login Kit for Web" plus the Display API (§6.1). Live only when TIKTOK_CLIENT_KEY and
 * a valid TIKTOK_CLIENT_SECRET are set. UNTESTED END TO END in this sandbox (no route to TikTok).
 * PKCE (S256) is on unless TIKTOK_USE_PKCE=0, in case the registered Web app rejects it; that
 * behaviour is unverified here. Playback uses only the API's embed_link (permitted embed).
 */
const SCOPES = "user.info.basic,user.info.profile,video.list"
const HOUR = 3_600_000

function classify(code: string | undefined, status: number): ProviderError {
  if (code === "access_token_invalid" || code === "invalid_grant" || status === 401) return new ProviderError("auth", "TikTok access expired. Reconnect to keep your feed updating.", code ?? String(status))
  if (code === "scope_not_authorized" || code === "scope_permission_missed") return new ProviderError("permission", "TikTok didn't give Yard permission to read your videos. Reconnect and allow access.", code)
  if (code === "rate_limit_exceeded" || status === 429) return new ProviderError("rate", "TikTok asked Yard to slow down. Yard tries again in an hour.", code ?? "429")
  return new ProviderError("other", "TikTok didn't answer as expected. Try again later.", code ?? String(status))
}

async function api(url: string, init?: RequestInit) {
  const res = await providerFetch(url, init)
  const body = await readJson(res)
  const err = body.error as { code?: string } | string | undefined
  const code = typeof err === "string" ? err : err?.code
  if (!res.ok || (code && code !== "ok")) throw classify(code, res.status)
  return body
}

const form = (fields: Record<string, string>) => ({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() })

function tokenSet(r: Record<string, unknown>, fallback?: TokenSet): TokenSet {
  const accessToken = String(r.access_token ?? "")
  if (!accessToken) throw new ProviderError("auth", "TikTok didn't return an access token. Reconnect.", "no_token")
  return {
    accessToken,
    refreshToken: r.refresh_token ? String(r.refresh_token) : fallback?.refreshToken,
    expiresAt: new Date(Date.now() + (Number(r.expires_in) || 86_400) * 1000),
    refreshExpiresAt: r.refresh_expires_in ? new Date(Date.now() + Number(r.refresh_expires_in) * 1000) : fallback?.refreshExpiresAt,
    scopes: String(r.scope ?? fallback?.scopes.join(",") ?? SCOPES).split(",").map((s) => s.trim()).filter(Boolean),
    externalUserId: String(r.open_id ?? fallback?.externalUserId ?? ""),
  }
}

export function tiktokProvider(): SocialProvider {
  const env = () => getEnv().tiktok
  return {
    id: "tiktok",
    mode: "live",
    refreshWindowMs: HOUR,
    usesPkce: () => env().usePkce,
    configured: () => env().configured,

    authorizeUrl({ state, redirectUri, codeChallenge }) {
      const q = new URLSearchParams({ client_key: env().clientKey ?? "", scope: SCOPES, response_type: "code", redirect_uri: redirectUri, state })
      if (codeChallenge) {
        q.set("code_challenge", codeChallenge)
        q.set("code_challenge_method", "S256")
      }
      return `https://www.tiktok.com/v2/auth/authorize/?${q.toString()}`
    },

    async exchangeCode({ code, redirectUri, codeVerifier }) {
      const e = env()
      if (!e.configured) throw new ProviderError("other", "TikTok isn't switched on for Yard.", "not_configured")
      const fields: Record<string, string> = { client_key: e.clientKey!, client_secret: e.clientSecret!, code, grant_type: "authorization_code", redirect_uri: redirectUri }
      if (codeVerifier) fields.code_verifier = codeVerifier
      return tokenSet(await api("https://open.tiktokapis.com/v2/oauth/token/", form(fields)))
    },

    async refresh(t) {
      const e = env()
      if (!t.refreshToken) throw new ProviderError("auth", "TikTok access expired. Reconnect to keep your feed updating.", "no_refresh_token")
      const r = await api("https://open.tiktokapis.com/v2/oauth/token/", form({ client_key: e.clientKey!, client_secret: e.clientSecret!, grant_type: "refresh_token", refresh_token: t.refreshToken }))
      return tokenSet(r, t)
    },

    async revoke(t) {
      const e = env()
      await api("https://open.tiktokapis.com/v2/oauth/revoke/", form({ client_key: e.clientKey!, client_secret: e.clientSecret!, token: t.accessToken }))
    },

    async profile(t) {
      const r = await api("https://open.tiktokapis.com/v2/user/info/?fields=open_id,avatar_url,display_name,username", { headers: { Authorization: `Bearer ${t.accessToken}` } })
      const u = ((r.data as { user?: Record<string, unknown> } | undefined)?.user ?? {}) as Record<string, unknown>
      return {
        externalUserId: String(u.open_id ?? t.externalUserId),
        handle: String(u.username ?? ""),
        displayName: String(u.display_name ?? u.username ?? ""),
        avatarUrl: u.avatar_url ? String(u.avatar_url) : undefined,
      }
    },

    async listMedia(t, cursor) {
      const fields = "id,title,video_description,create_time,cover_image_url,share_url,embed_link,duration,width,height"
      const body: Record<string, unknown> = { max_count: 20 }
      if (cursor) body.cursor = Number(cursor)
      const r = await api(`https://open.tiktokapis.com/v2/video/list/?fields=${fields}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${t.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = (r.data ?? {}) as { videos?: Record<string, unknown>[]; cursor?: number; has_more?: boolean }
      const items: RemotePost[] = []
      for (const v of data.videos ?? []) {
        const cover = v.cover_image_url ? String(v.cover_image_url) : ""
        if (!cover) continue
        items.push({
          externalId: String(v.id),
          kind: "video",
          caption: String(v.video_description ?? v.title ?? "").slice(0, 2200),
          permalink: v.share_url ? String(v.share_url) : undefined,
          embedUrl: v.embed_link ? String(v.embed_link) : undefined,
          postedAt: new Date((Number(v.create_time) || Date.now() / 1000) * 1000),
          // Videos play through the embed; covers are signed and expire, so only the cover is downloaded.
          media: [{ url: cover, kind: "video", posterUrl: cover, width: Number(v.width) || undefined, height: Number(v.height) || undefined, durationMs: v.duration ? Number(v.duration) * 1000 : undefined }],
        })
      }
      return { items, next: data.has_more && data.cursor !== undefined ? String(data.cursor) : undefined }
    },
  } satisfies SocialProvider
}
