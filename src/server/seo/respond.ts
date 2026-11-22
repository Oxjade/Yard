import "server-only"
import { log } from "../log"

/**
 * Responses for the machine-readable documents (feeds, sitemaps, llms.txt). They are public and the
 * same for every visitor, so a CDN or the reverse proxy may keep them for `maxAge` seconds on top
 * of the server's own memo; a failed build answers 503 with Retry-After and is never cached.
 */
export function documentResponse(body: string, contentType: string, maxAge: number, extra: Record<string, string> = {}) {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=${maxAge}`,
      "X-Content-Type-Options": "nosniff",
      ...extra,
    },
  })
}

export function unavailable(what: string, error: unknown) {
  log.error(`[yard] ${what} failed`, error)
  return new Response(`${what} is unavailable right now. Try again in a few minutes.\n`, {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "300" },
  })
}

export const notFoundText = () => new Response("Not found\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } })
