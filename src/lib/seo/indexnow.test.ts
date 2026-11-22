import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { productPageVisibility, brandPageVisibility } from "../page-visibility"
import { backoffMs, classifyStatus, decideSubmissions, flushQueue, MAX_ATTEMPTS, MAX_URLS, publicHost, type Candidate, type QueueRow, type QueueStore } from "./indexnow"

const base = "https://yardstore.space"
const brand = { founding: false, launchedAt: null, reviewStatus: "approved" }
const founding = { founding: true, launchedAt: null, reviewStatus: "approved" }
const restricted = { founding: false, launchedAt: null, reviewStatus: "restricted" }
const published = { status: "published", publishAt: null, moderationStatus: "ok" }
const draft = { status: "draft", publishAt: null, moderationStatus: "ok" }
const hidden = { status: "published", publishAt: null, moderationStatus: "hidden" }
const url = (slug: string) => `${base}/products/${slug}`

describe("which URLs IndexNow is told about", () => {
  const candidates: Candidate[] = [
    { url: url("live"), visibility: productPageVisibility(published, brand), everPublic: true },
    { url: url("draft"), visibility: productPageVisibility(draft, brand), everPublic: false },
    { url: url("opens-soon"), visibility: productPageVisibility(published, founding), everPublic: false },
    { url: url("hidden-was-live"), visibility: productPageVisibility(hidden, brand), everPublic: true },
    { url: url("hidden-known-live"), visibility: productPageVisibility(hidden, brand), everPublic: false },
    { url: url("hidden-already-told"), visibility: productPageVisibility(hidden, brand), everPublic: true },
    { url: `${base}/brands/gone`, visibility: brandPageVisibility(restricted), everPublic: true },
    { url: url("live"), visibility: "public", everPublic: true },
  ]
  const known = new Map([
    [url("hidden-known-live"), true],
    [url("hidden-already-told"), false],
  ])
  const out = new Map(decideSubmissions(candidates, known).map((r) => [r.url, r.live]))

  it("sends public pages as live, once each", () => {
    assert.equal(out.get(url("live")), true)
    assert.equal([...out.keys()].filter((u) => u === url("live")).length, 1)
  })
  it("never sends drafts or opens-soon pages", () => {
    assert.equal(out.has(url("draft")), false)
    assert.equal(out.has(url("opens-soon")), false)
  })
  it("sends a page that just became hidden, once", () => {
    assert.equal(out.get(url("hidden-was-live")), false)
    assert.equal(out.get(url("hidden-known-live")), false)
    assert.equal(out.get(`${base}/brands/gone`), false)
    assert.equal(out.has(url("hidden-already-told")), false)
  })
})

describe("flushing the queue", () => {
  /** An in-memory queue with the same rules as indexnow_urls. */
  function memoryStore(urls: string[]) {
    const rows = new Map(urls.map((u, i) => [u, { url: u, attempts: 0, pending: true, nextAt: 0, order: i, error: null as string | null }]))
    const store: QueueStore = {
      async due(now, limit) {
        return [...rows.values()].filter((r) => r.pending && r.nextAt <= now.getTime()).sort((a, b) => a.order - b.order).slice(0, limit).map((r): QueueRow => ({ url: r.url, attempts: r.attempts }))
      },
      async sent(list) {
        for (const u of list) Object.assign(rows.get(u)!, { pending: false, attempts: 0 })
      },
      async retry(list, retryAt, error) {
        for (const r of list) Object.assign(rows.get(r.url)!, { attempts: r.attempts + 1, nextAt: retryAt(r.attempts + 1).getTime(), error })
      },
      async dropped(list, error) {
        for (const u of list) Object.assign(rows.get(u)!, { pending: false, error })
      },
    }
    return { rows, store }
  }
  const key = "0123456789abcdef0123456789abcdef"
  type Call = { url: string; body: { host: string; key: string; keyLocation: string; urlList: string[] } }
  const mockFetch = (statuses: number[], calls: Call[]) =>
    (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) })
      return new Response(null, { status: statuses.shift() ?? 200 })
    }) as typeof fetch

  it("posts {host, key, keyLocation, urlList} and marks them sent", async () => {
    const { rows, store } = memoryStore([url("a"), url("b")])
    const calls: Call[] = []
    const lines: string[] = []
    const r = await flushQueue(store, { key, origin: base, fetch: mockFetch([202], calls), log: (l) => lines.push(l) })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, "https://api.indexnow.org/indexnow")
    assert.deepEqual(calls[0].body, { host: "yardstore.space", key, keyLocation: `${base}/${key}.txt`, urlList: [url("a"), url("b")] })
    assert.equal(r.sent, 2)
    assert.equal([...rows.values()].some((x) => x.pending), false)
    assert.equal(lines.length, 1)
    assert.match(lines[0], /2 sent, 0 to retry, 0 dropped in 1 request\(s\) \(HTTP 202\)/)
  })

  it("does nothing, and logs nothing, with an empty queue", async () => {
    const { store } = memoryStore([])
    const calls: Call[] = []
    const lines: string[] = []
    const r = await flushQueue(store, { key, origin: base, fetch: mockFetch([], calls), log: (l) => lines.push(l) })
    assert.equal(calls.length + lines.length + r.requests, 0)
  })

  it("splits at 10,000 URLs a request", async () => {
    const { store } = memoryStore(Array.from({ length: MAX_URLS + 5 }, (_, i) => url(`p${i}`)))
    const calls: Call[] = []
    const r = await flushQueue(store, { key, origin: base, fetch: mockFetch([200, 200], calls) })
    assert.deepEqual(calls.map((c) => c.body.urlList.length), [MAX_URLS, 5])
    assert.equal(r.sent, MAX_URLS + 5)
  })

  it("retries 429 and network errors with backoff, then gives up", async () => {
    const { rows, store } = memoryStore([url("a")])
    let t = 0
    const now = () => new Date(t)
    const calls: Call[] = []
    await flushQueue(store, { key, origin: base, fetch: mockFetch([429], calls), now })
    assert.equal(rows.get(url("a"))!.attempts, 1)
    assert.equal(rows.get(url("a"))!.nextAt, backoffMs(1))
    // Not due yet: nothing is sent.
    await flushQueue(store, { key, origin: base, fetch: mockFetch([200], calls), now })
    assert.equal(calls.length, 1)
    const failing = (async () => {
      throw new Error("ECONNRESET")
    }) as unknown as typeof fetch
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      t = rows.get(url("a"))!.nextAt
      await flushQueue(store, { key, origin: base, fetch: failing, now })
    }
    assert.equal(rows.get(url("a"))!.pending, false)
    assert.match(rows.get(url("a"))!.error!, /after 8 attempts/)
    assert.ok(backoffMs(2) > backoffMs(1) && backoffMs(30) === 360 * 60_000)
  })

  it("drops a 422 (not retried) and URLs on another host", async () => {
    const { rows, store } = memoryStore(["https://elsewhere.example/x", url("a")])
    const calls: Call[] = []
    const r = await flushQueue(store, { key, origin: base, fetch: mockFetch([422], calls) })
    assert.deepEqual(calls[0].body.urlList, [url("a")])
    assert.equal(r.dropped, 2)
    assert.equal([...rows.values()].some((x) => x.pending), false)
  })

  it("keeps URLs queued while the server isn't on a public https address", async () => {
    const { rows, store } = memoryStore(["http://localhost:3000/products/a"])
    const calls: Call[] = []
    const r = await flushQueue(store, { key, origin: "http://localhost:3000", fetch: mockFetch([], calls) })
    assert.equal(calls.length, 0)
    assert.match(r.skipped!, /not a public https address/)
    assert.equal(rows.get("http://localhost:3000/products/a")!.pending, true)
  })

  it("classifies statuses and public hosts", () => {
    assert.deepEqual([200, 202, 400, 403, 422, 429, 500].map(classifyStatus), ["ok", "ok", "drop", "retry", "drop", "retry", "retry"])
    assert.equal(publicHost("https://yardstore.space"), "yardstore.space")
    assert.equal(publicHost("http://yardstore.space"), null)
    assert.equal(publicHost("https://localhost:3000"), null)
    assert.equal(publicHost("https://192.168.1.2"), null)
  })
})
