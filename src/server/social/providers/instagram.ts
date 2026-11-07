import "server-only"
import { getEnv } from "../../env"
import { ProviderError, providerFetch, readJson, type RemotePost, type SocialProvider, type TokenSet } from "./types"

/**
 * "Instagram API with Instagram Login" (§6.1). Live only when INSTAGRAM_APP_ID and a valid
 * INSTAGRAM_APP_SECRET are set. UNTESTED END TO END in this sandbox (no route to Instagram):
 * the endpoints and fields follow Meta's documentation; check INSTAGRAM_GRAPH_VERSION against
 * Meta's changelog when keys are added. Scope instagram_business_basic reads the profile and the
 * account's own media only. There is no revoke endpoint for this flow.
 */
const SCOPE = "instagram_business_basic"
const DAY = 86_400_000

type GraphError = { message?: string; type?: string; code?: number; error_subcode?: number }

/** Maps a Graph API error to a safe status (§6.1 Errors). Never passes Meta's message on. */
function classify(err: GraphError | undefined, status: number): ProviderError {
  const code = err?.code
  if (code === 190 || (err?.type === "OAuthException" && status === 401)) return new ProviderError("auth", "Instagram access expired. Reconnect to keep your feed updating.", String(code ?? status))
  if (code === 4 || code === 17 || code === 32 || code === 613) return new ProviderError("rate", "Instagram asked Yard to slow down. Yard tries again in an hour.", String(code))
  if (code === 10 || (code !== undefined && code >= 200 && code < 300)) return new ProviderError("permission", "Instagram didn't give Yard permission to read your posts. Reconnect and allow access.", String(code))
  return new ProviderError("other", "Instagram didn't answer as expected. Try again later.", String(code ?? status))
}

async function graph(url: string, init?: RequestInit) {
  const res = await providerFetch(url, init)
  const body = await readJson(res)
  if (!res.ok || body.error) throw classify(body.error as GraphError | undefined, res.status)
  return body
}

/** Instagram timestamps look like 2026-11-04T18:10:00+0000. */
const igDate = (s: unknown) => {
  const d = new Date(String(s ?? "").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"))
  return Number.isNaN(d.getTime()) ? new Date() : d
}

const expiry = (seconds: unknown) => (typeof seconds === "number" && seconds > 0 ? new Date(Date.now() + seconds * 1000) : new Date(Date.now() + 60 * DAY))

export function instagramProvider(): SocialProvider {
  const env = () => getEnv().instagram
  const v = () => env().graphVersion
  return {
    id: "instagram",
    mode: "live",
    refreshWindowMs: 10 * DAY,
    usesPkce: () => false,
    configured: () => env().configured,

    authorizeUrl({ state, redirectUri }) {
      const q = new URLSearchParams({ client_id: env().appId ?? "", redirect_uri: redirectUri, response_type: "code", scope: SCOPE, state, enable_fb_login: "0", force_reauth: "true" })
      return `https://www.instagram.com/oauth/authorize?${q.toString()}`
    },

    async exchangeCode({ code, redirectUri }) {
      const e = env()
      if (!e.configured) throw new ProviderError("other", "Instagram isn't switched on for Yard.", "not_configured")
      // 1. Code → short-lived token (form POST). Instagram can append "#_" to the code.
      const form = new URLSearchParams({ client_id: e.appId!, client_secret: e.appSecret!, grant_type: "authorization_code", redirect_uri: redirectUri, code: code.replace(/#_$/, "") })
      const short = await graph("https://api.instagram.com/oauth/access_token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() })
      const row = (Array.isArray(short.data) ? (short.data[0] as Record<string, unknown>) : short) ?? {}
      const shortToken = String(row.access_token ?? "")
      const userId = String(row.user_id ?? "")
      if (!shortToken || !userId) throw new ProviderError("other", "Instagram didn't return an access token.", "no_token")
      const scopes = String(row.permissions ?? SCOPE).split(",").map((x) => x.trim()).filter(Boolean)
      // 2. Short-lived → long-lived (about 60 days).
      const q = new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: e.appSecret!, access_token: shortToken })
      const long = await graph(`https://graph.instagram.com/access_token?${q.toString()}`)
      const accessToken = String(long.access_token ?? "")
      if (!accessToken) throw new ProviderError("other", "Instagram didn't return a long-lived token.", "no_long_token")
      return { accessToken, expiresAt: expiry(long.expires_in), scopes, externalUserId: userId }
    },

    async refresh(t) {
      // Only tokens at least 24 h old can be refreshed; the scheduler refreshes within 10 days of expiry.
      const q = new URLSearchParams({ grant_type: "ig_refresh_token", access_token: t.accessToken })
      const r = await graph(`https://graph.instagram.com/refresh_access_token?${q.toString()}`)
      const accessToken = String(r.access_token ?? "")
      if (!accessToken) throw new ProviderError("auth", "Instagram access expired. Reconnect to keep your feed updating.", "refresh_failed")
      return { ...t, accessToken, expiresAt: expiry(r.expires_in) }
    },

    async profile(t) {
      const q = new URLSearchParams({ fields: "user_id,username,name,account_type,profile_picture_url", access_token: t.accessToken })
      const p = await graph(`https://graph.instagram.com/${v()}/me?${q.toString()}`)
      const accountType = p.account_type ? String(p.account_type) : undefined
      if (accountType && accountType !== "BUSINESS" && accountType !== "MEDIA_CREATOR") {
        throw new ProviderError("permission", "Needs an Instagram professional account (Business or Creator). Personal accounts can't connect — upload posts instead.", "personal_account")
      }
      return {
        externalUserId: String(p.user_id ?? p.id ?? t.externalUserId),
        handle: String(p.username ?? ""),
        displayName: String(p.name ?? p.username ?? ""),
        avatarUrl: p.profile_picture_url ? String(p.profile_picture_url) : undefined,
        accountType,
      }
    },

    async listMedia(t, cursor) {
      const q = new URLSearchParams({
        fields: "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,children{media_type,media_url,thumbnail_url}",
        limit: "25",
        access_token: t.accessToken,
      })
      if (cursor) q.set("after", cursor)
      const r = await graph(`https://graph.instagram.com/${v()}/me/media?${q.toString()}`)
      const items: RemotePost[] = []
      for (const raw of (Array.isArray(r.data) ? r.data : []) as Record<string, unknown>[]) {
        const type = String(raw.media_type ?? "IMAGE")
        const one = (m: Record<string, unknown>) =>
          String(m.media_type) === "VIDEO"
            ? { url: String(m.media_url ?? ""), kind: "video" as const, posterUrl: m.thumbnail_url ? String(m.thumbnail_url) : undefined }
            : { url: String(m.media_url ?? ""), kind: "image" as const }
        const children = ((raw.children as { data?: Record<string, unknown>[] } | undefined)?.data ?? []).map(one).filter((m) => m.url)
        const media = type === "CAROUSEL_ALBUM" ? children : [one(raw)].filter((m) => m.url)
        if (!media.length) continue
        items.push({
          externalId: String(raw.id),
          kind: type === "CAROUSEL_ALBUM" ? "carousel" : type === "VIDEO" ? "video" : "image",
          caption: String(raw.caption ?? "").slice(0, 2200),
          permalink: raw.permalink ? String(raw.permalink) : undefined,
          postedAt: igDate(raw.timestamp),
          media,
        })
      }
      const paging = r.paging as { cursors?: { after?: string }; next?: string } | undefined
      return { items, next: paging?.next ? paging.cursors?.after : undefined }
    },
  } satisfies SocialProvider
}

export type { TokenSet }
