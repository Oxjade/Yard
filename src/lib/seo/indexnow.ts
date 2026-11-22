/**
 * IndexNow (Bing, Yandex, Seznam, Naver; Bing's index also feeds ChatGPT search): tells search
 * engines which public URLs changed, so they re-crawl them within minutes instead of days.
 *
 * Pure: the server (src/server/seo/indexnow.ts) passes in the queue store, fetch and the clock.
 * - Which URLs: decideSubmissions() follows src/lib/page-visibility.ts. A public page is sent. A
 *   page that isn't public is sent only when it just stopped being public (we last told the
 *   engines it was live, or, for a URL we never sent, it was published under a listed brand), so
 *   the engine re-crawls it and drops it. Drafts, opens-soon pages and pages that were never
 *   public are never sent.
 * - How: flushQueue() POSTs at most MAX_URLS per request ({host, key, keyLocation, urlList}),
 *   retries 429, 5xx, 403 and network errors with backoff, and gives up after MAX_ATTEMPTS.
 */
import type { PageVisibility } from "../page-visibility"

export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow"
/** The protocol's cap per request. */
export const MAX_URLS = 10_000
/** Requests per flush: a backlog drains over a few flushes instead of in one burst. */
export const MAX_REQUESTS_PER_FLUSH = 3
export const MAX_ATTEMPTS = 8
const MIN = 60_000

export type Candidate = {
  url: string
  visibility: PageVisibility
  /** For a URL never sent before: was it ever public? (published product of a launched brand, a launched brand). */
  everPublic?: boolean
}

/** url → the state we last queued for it (true = live). Missing = never queued. */
export type Known = Map<string, boolean>

/** The URLs to queue and whether each is live. Deduplicated; "live" wins when one URL appears twice. */
export function decideSubmissions(candidates: Candidate[], known: Known): { url: string; live: boolean }[] {
  const out = new Map<string, boolean>()
  for (const c of candidates) {
    if (c.visibility === "public") {
      out.set(c.url, true)
      continue
    }
    if (out.get(c.url) === true) continue
    const last = known.get(c.url)
    // Just became hidden: send once so the engine drops it. Never-public pages stay unsent.
    if (last === true || (last === undefined && c.everPublic === true)) out.set(c.url, false)
  }
  return [...out].map(([url, live]) => ({ url, live }))
}

/** 5, 10, 20 … minutes, at most 6 hours. */
export const backoffMs = (attempts: number) => Math.min(5 * MIN * 2 ** Math.max(0, attempts - 1), 360 * MIN)

/** 200/202 done; 429, 5xx, 403 (key file not reachable yet) retry; anything else (400, 422) is dropped. */
export function classifyStatus(status: number): "ok" | "retry" | "drop" {
  if (status === 200 || status === 202) return "ok"
  if (status === 429 || status === 403 || status >= 500) return "retry"
  return "drop"
}

/** Only real public https addresses are worth sending (never localhost or a private name). */
export function publicHost(origin: string): string | null {
  try {
    const u = new URL(origin)
    const h = u.hostname
    if (u.protocol !== "https:") return null
    if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || /^(127|10|192\.168|169\.254)\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || !h.includes(".")) return null
    return h
  } catch {
    return null
  }
}

export type QueueRow = { url: string; attempts: number }

export interface QueueStore {
  /** Rows due now, oldest first. */
  due(now: Date, limit: number): Promise<QueueRow[]>
  /** Sent: no longer pending. */
  sent(urls: string[], now: Date): Promise<void>
  /** Try again at `retryAt`. */
  retry(rows: QueueRow[], retryAt: (attempts: number) => Date, error: string): Promise<void>
  /** Not worth retrying: no longer pending, the error kept. */
  dropped(urls: string[], error: string): Promise<void>
}

export type FlushOptions = {
  key: string
  /** The public origin, e.g. https://yardstore.space. */
  origin: string
  endpoint?: string
  fetch: typeof fetch
  now?: () => Date
  log?: (line: string) => void
}

export type FlushResult = { sent: number; retry: number; dropped: number; requests: number; skipped?: string; statuses: number[] }

/** One flush: up to MAX_REQUESTS_PER_FLUSH requests of up to MAX_URLS each. Logs one line when it did anything. */
export async function flushQueue(store: QueueStore, o: FlushOptions): Promise<FlushResult> {
  const now = o.now ?? (() => new Date())
  const endpoint = o.endpoint ?? INDEXNOW_ENDPOINT
  const result: FlushResult = { sent: 0, retry: 0, dropped: 0, requests: 0, statuses: [] }
  let host: string | null
  try {
    host = endpoint === INDEXNOW_ENDPOINT ? publicHost(o.origin) : new URL(o.origin).host
  } catch {
    host = null
  }
  const base = o.origin.replace(/\/+$/, "")
  for (let i = 0; i < MAX_REQUESTS_PER_FLUSH; i++) {
    const rows = await store.due(now(), MAX_URLS)
    if (!rows.length) break
    if (!host) {
      // Keep them queued: they go out once the server runs on its public https address.
      result.skipped = `${o.origin} is not a public https address`
      break
    }
    // Every URL in one request must be on the key's host.
    const mine = rows.filter((r) => sameHost(r.url, host!))
    const foreign = rows.filter((r) => !sameHost(r.url, host!))
    if (foreign.length) {
      await store.dropped(foreign.map((r) => r.url), `not on ${host}`)
      result.dropped += foreign.length
    }
    if (!mine.length) continue
    const body = { host, key: o.key, keyLocation: `${base}/${o.key}.txt`, urlList: mine.map((r) => r.url) }
    result.requests++
    let verdict: "ok" | "retry" | "drop"
    let error = ""
    try {
      const res = await o.fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) })
      result.statuses.push(res.status)
      verdict = classifyStatus(res.status)
      error = `HTTP ${res.status}`
    } catch (e) {
      verdict = "retry"
      error = e instanceof Error ? e.message : String(e)
      result.statuses.push(0)
    }
    if (verdict === "ok") {
      await store.sent(body.urlList, now())
      result.sent += mine.length
      continue
    }
    if (verdict === "drop") {
      await store.dropped(body.urlList, error)
      result.dropped += mine.length
      break
    }
    const giveUp = mine.filter((r) => r.attempts + 1 >= MAX_ATTEMPTS)
    const again = mine.filter((r) => r.attempts + 1 < MAX_ATTEMPTS)
    if (giveUp.length) await store.dropped(giveUp.map((r) => r.url), `${error} after ${MAX_ATTEMPTS} attempts`)
    if (again.length) await store.retry(again, (attempts) => new Date(now().getTime() + backoffMs(attempts)), error)
    result.retry += again.length
    result.dropped += giveUp.length
    // The engine is unhappy: stop for this flush.
    break
  }
  if (result.requests || result.dropped || result.skipped)
    o.log?.(
      `[yard] indexnow: ${result.sent} sent, ${result.retry} to retry, ${result.dropped} dropped in ${result.requests} request(s)${result.statuses.length ? ` (HTTP ${result.statuses.join(", ")})` : ""}${result.skipped ? `; waiting: ${result.skipped}` : ""}`,
    )
  return result
}

function sameHost(url: string, host: string) {
  try {
    return new URL(url).host === host
  } catch {
    return false
  }
}
