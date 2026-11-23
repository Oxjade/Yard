import { HTML_LIMITED_BOT_UA_RE } from "next/dist/shared/lib/router/utils/html-bots"

/**
 * Clients that get every page's metadata (<title>, description, canonical, Open Graph) in the
 * <head> of the first response: next.config.ts `htmlLimitedBots`.
 *
 * With Cache Components a page whose metadata reads request-time data (a product, a brand, /shop's
 * search) streams that metadata: browsers get the static shell at once and the <title> arrives
 * later, appended to the <body>. That is fine for a browser, which runs the page, but crawlers and
 * AI tools that read the raw HTML either miss it or meet it after the body has started. Next renders
 * the whole page (no streaming, metadata in the <head>) for user agents this pattern matches.
 *
 * Setting the option replaces Next's own list, so it starts from that list (Bingbot, the
 * "-Google" crawlers, social link previews and the rest), then adds:
 * - Googlebot itself, and the AI crawlers and assistants' fetchers (OpenAI, Anthropic, Perplexity,
 *   Apple, Amazon, Meta, Common Crawl and others), none of which are in Next's list;
 * - any client whose user agent doesn't start with "Mozilla/": curl, wget, HTTP libraries and the
 *   simple fetchers AI tools use. Every browser (and every in-app WebView) starts with it.
 *
 * Cost: a matching request renders the whole page instead of the prerendered shell plus its
 * streamed parts. The streamed parts render per request either way; only the static rest is extra.
 */
const EXTRA_BOTS = [
  "Googlebot",
  "GoogleOther",
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "Claude-Web",
  "anthropic-ai",
  "PerplexityBot",
  "Perplexity-User",
  "Amazonbot",
  "meta-externalagent",
  "meta-externalfetcher",
  "FacebookBot",
  "CCBot",
  "Bytespider",
  "cohere-ai",
  "MistralAI-User",
  "DuckAssistBot",
  "YouBot",
  "Diffbot",
  "AI2Bot",
  "PetalBot",
]

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Next's HTML-limited bots, the crawlers above, and any user agent that isn't a browser's. */
export const HTML_LIMITED_BOTS = new RegExp(`${HTML_LIMITED_BOT_UA_RE.source}|${EXTRA_BOTS.map(escape).join("|")}|^(?!Mozilla/)`, "i")

/** Whether `userAgent` gets blocking metadata (Next's own test: a non-empty user agent that matches). */
export const getsBlockingMetadata = (userAgent: string | null | undefined) => !!userAgent && HTML_LIMITED_BOTS.test(userAgent)
