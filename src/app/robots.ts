import type { MetadataRoute } from "next"
import { connection } from "next/server"
import { publicOrigin } from "@/lib/seo/url"

/** Accounts, Studio, the Control Center, the API and checkout: never crawled, by anyone. */
const PRIVATE = ["/admin", "/studio", "/api/", "/auth/", "/you", "/bag", "/checkout", "/inbox", "/notifications", "/wishlist", "/following", "/welcome", "/unsubscribe", "/dev", "/vendor"]

/**
 * The search and AI crawlers Yard wants to read it: search indexes (Googlebot, Bingbot, Applebot),
 * AI search and answer engines (OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User,
 * PerplexityBot, Perplexity-User) and the model-training opt-in tokens (GPTBot, ClaudeBot,
 * Google-Extended, Applebot-Extended). A crawler with its own group ignores the "*" group, so each
 * group repeats the private disallows.
 */
/**
 * Public photos are served from /api/media/<id> (the route serves only public media to an anonymous
 * request). Allowed explicitly, since the longest matching rule wins over "/api/": Google Images,
 * Merchant Center and AI answers must be able to fetch a product's photos.
 */
const ALLOW = ["/", "/api/media/"]

export const AI_AND_SEARCH_CRAWLERS = [
  "Googlebot",
  "Bingbot",
  "Applebot",
  "Applebot-Extended",
  "Google-Extended",
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "PerplexityBot",
  "Perplexity-User",
]

/** /robots.txt: the shop, llms.txt and the product feeds are crawlable; private areas are not. */
export default async function robots(): Promise<MetadataRoute.Robots> {
  // Read at request time: the public address comes from the server's environment, not the build's.
  await connection()
  const origin = publicOrigin()
  return {
    rules: [
      { userAgent: AI_AND_SEARCH_CRAWLERS, allow: ALLOW, disallow: PRIVATE },
      { userAgent: "*", allow: ALLOW, disallow: PRIVATE },
    ],
    sitemap: [`${origin}/sitemap.xml`],
    host: origin,
  }
}
