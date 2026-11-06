import "server-only"
import { randomBytes } from "node:crypto"
import { brandById } from "@/lib/data/brands"
import { img } from "@/lib/data/media"
import { DEMO_TODAY, hash } from "@/lib/data/seed"
import { getEnv } from "../../env"
import { ProviderError, type ProviderId, type RemotePost, type SocialProvider, type TokenSet } from "./types"

/**
 * The development sandbox (§6.1): runs connect → sync → feature → storefront on this machine
 * without Instagram or TikTok. Development only (env.sandboxEnabled): when it is off every call
 * refuses, and the consent page answers 404. Its consent page says plainly that it is not
 * Instagram or TikTok; its posts carry the Sandbox and Sample labels. Media come from
 * /public/media and are copied, never fetched.
 */

/** Photographs that suit each brand category (the media library's own categories). */
const pools: Record<string, string[]> = {
  streetwear: ["fashion/streetwear-editorial", "fashion/tops", "fashion/campaign", "fashion/outerwear"],
  fashion: ["fashion/campaign", "fashion/dresses", "fashion/bottoms", "fashion/outerwear"],
  sneakers: ["objects/sneakers"],
  jewelry: ["objects/jewelry"],
  accessories: ["objects/bags", "objects/eyewear", "objects/headwear", "objects/accessories-editorial"],
  beauty: ["lifestyle/beauty"],
  technology: ["lifestyle/tech"],
  "home-lifestyle": ["lifestyle/home"],
  "art-design": ["lifestyle/art"],
  creative: ["lifestyle/creative"],
}

const captions = [
  "Studio day. Samples on the rail before the next run.",
  "Fitting notes from this week.",
  "Behind the print table.",
  "First look at what we're finishing now.",
  "Shot on the way to the studio this morning.",
  "Packing orders for this week's dispatch.",
  "Detail of the finish, up close.",
  "Two colourways, side by side.",
  "The last of this run.",
  "Test prints that didn't make the cut.",
  "Night shoot for the next drop.",
  "Back in stock soon. Set a reminder on Yard.",
]

export const SANDBOX_POSTS = 12

/** The sandbox's 12 deterministic posts for a brand (images only, newest first, two days apart). */
export function sandboxPosts(provider: ProviderId, brandId: string): RemotePost[] {
  const brand = brandById.get(brandId)
  const cats = brand?.categories.flatMap((c) => pools[c] ?? []) ?? []
  const refs = (cats.length ? cats : ["fashion/campaign", "fashion/cover"]).flatMap((c) => Array.from({ length: 12 }, (_, i) => `${c}/${i}`))
  const seen = new Set<string>()
  const images = refs
    .map((ref) => img(ref))
    .filter((im) => (seen.has(im.src) ? false : (seen.add(im.src), true)))
    .sort((a, b) => hash(`${brandId}:${a.src}`) - hash(`${brandId}:${b.src}`))
  // Top up from the covers when a category is small, so every brand gets 12.
  for (let i = 0; images.length < SANDBOX_POSTS && i < 40; i++) {
    const im = img(`fashion/cover/${i}`)
    if (!seen.has(im.src)) {
      seen.add(im.src)
      images.push(im)
    }
  }
  const anchor = Date.parse(`${DEMO_TODAY}T12:00:00Z`)
  const prefix = provider === "instagram" ? "ig" : "tt"
  return images.slice(0, SANDBOX_POSTS).map((im, i) => ({
    externalId: `${prefix}_sbx_${i + 1}`,
    kind: "image",
    // Each caption once per brand, in a brand-specific order.
    caption: captions[(hash(brandId) + i) % captions.length],
    postedAt: new Date(anchor - i * 2 * 86_400_000),
    media: [{ url: im.src, kind: "image", width: im.width, height: im.height }],
  }))
}

function refuse(): never {
  throw new ProviderError("other", "The development sandbox is off.", "sandbox_off")
}

/** The sandbox for one provider and brand (its handle and posts come from the brand's sample data). */
export function sandboxProvider(id: ProviderId, brandId: string): SocialProvider {
  const on = () => getEnv().sandboxEnabled
  return {
    id,
    mode: "sandbox",
    refreshWindowMs: 0,
    usesPkce: () => false,
    configured: on,

    authorizeUrl({ state }) {
      if (!on()) refuse()
      return `/studio/social/sandbox?${new URLSearchParams({ provider: id, state }).toString()}`
    },

    async exchangeCode({ code }) {
      if (!on()) refuse()
      if (!/^sandbox_[A-Za-z0-9_-]{8,64}$/.test(code)) throw new ProviderError("auth", "The sandbox only accepts its own codes.", "bad_code")
      // Fake tokens, still sealed in the vault, so the vault path is exercised.
      return { accessToken: `sbx_at_${randomBytes(18).toString("base64url")}`, refreshToken: `sbx_rt_${randomBytes(18).toString("base64url")}`, scopes: ["sandbox"], externalUserId: `sbx_${id}_${brandId}` } satisfies TokenSet
    },

    async refresh(t) {
      if (!on()) refuse()
      return t
    },

    async revoke() {
      if (!on()) refuse()
    },

    async profile(t) {
      if (!on()) refuse()
      const brand = brandById.get(brandId)
      const handle = (id === "instagram" ? brand?.social.instagram : brand?.social.tiktok) ?? brand?.handle ?? "sandbox"
      return { externalUserId: t.externalUserId, handle, displayName: `${brand?.name ?? "Brand"} (sandbox)`, accountType: id === "instagram" ? "BUSINESS" : undefined }
    },

    async listMedia() {
      if (!on()) refuse()
      return { items: sandboxPosts(id, brandId) }
    },
  }
}
