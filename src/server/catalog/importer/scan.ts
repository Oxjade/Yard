import { IMPORT_MAX_PRODUCTS, type ImportBrandDto, type ImportPlatform, type ImportProductDto, type ImportProgressDto } from "@/lib/api/contracts/imports"
import { bumpa } from "./adapters/bumpa"
import { generic } from "./adapters/generic"
import { labeld, labeldShopUrl } from "./adapters/labeld"
import { shopify } from "./adapters/shopify"
import type { Adapter, Home, Page, SiteFetch } from "./adapters/types"
import { woocommerce } from "./adapters/woocommerce"
import { FetchRefused, PAGE_CAP, type FetchOptions, type FetchResult } from "./fetch"
import { markDuplicates, normalizeProduct, type Existing, type NormalizeContext } from "./normalize"
import { cleanUrl } from "./url"

/**
 * One scan of a brand's website (docs/IMPORTER.md): clean the address, read the home page, try the
 * adapters in order (Shopify, WooCommerce, Labeld, Bumpa, then any site with schema.org Product data) and
 * normalise what the first one that finds products returns. Pure apart from the injected `get`, so
 * the tests run it against saved pages.
 */

export const ADAPTERS: Adapter[] = [shopify, woocommerce, labeld, bumpa, generic]

export type Get = (url: string, opts: FetchOptions) => Promise<FetchResult>

/** Requests at once, and the pause between the starts of two requests to the site. */
export const SITE_CONCURRENCY = 2
export const SITE_DELAY_MS = 350

/**
 * The site fetcher adapters use: at most SITE_CONCURRENCY requests at a time, SITE_DELAY_MS
 * between starts, a cap on requests per scan, the page byte cap, and JSON that is only parsed
 * when the answer says it's JSON (a catch-all HTML page for /products.json is "not Shopify").
 */
export function siteFetcher(fetchOne: Get, opts: { delayMs?: number; maxRequests?: number; sleep?: (ms: number) => Promise<void> } = {}): SiteFetch & { requests(): number } {
  const delay = opts.delayMs ?? SITE_DELAY_MS
  const max = opts.maxRequests ?? IMPORT_MAX_PRODUCTS * 2 + 40
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  let active = 0
  let count = 0
  let nextStart = 0
  const waiting: (() => void)[] = []
  const acquire = async () => {
    if (active >= SITE_CONCURRENCY) await new Promise<void>((r) => waiting.push(r))
    active++
    const now = Date.now()
    const at = Math.max(now, nextStart)
    nextStart = at + delay
    if (at > now) await sleep(at - now)
  }
  const release = () => {
    active--
    waiting.shift()?.()
  }
  const get = async (url: string, o?: { accept?: string }): Promise<Page> => {
    if (++count > max) throw new FetchRefused("too_large", `Stopped after ${max} requests to the site.`)
    await acquire()
    try {
      const r = await fetchOne(url, { accept: o?.accept ?? "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5", maxBytes: PAGE_CAP })
      return { url: r.url, status: r.status, contentType: r.contentType, text: r.body.toString("utf8") }
    } finally {
      release()
    }
  }
  return {
    get,
    async json<T>(url: string) {
      const page = await get(url, { accept: "application/json" })
      if (!/json/.test(page.contentType) && !/^\s*[[{]/.test(page.text)) return null
      try {
        return JSON.parse(page.text) as T
      } catch {
        return null
      }
    },
    requests: () => count,
  }
}

export type ScanOutcome = { platform: ImportPlatform; startUrl: string; brand: ImportBrandDto; products: ImportProductDto[]; warnings: string[] }

/** The address to scan: cleaned, and a Labeld marketplace page turned into the brand's own shop. */
export function startUrlOf(input: string): URL {
  const u = cleanUrl(input)
  return labeldShopUrl(u) ?? u
}

/**
 * `platform` (a watch run): only that adapter is tried, and a site that lists nothing new isn't
 * handed to the next adapter. `skipPage`: product pages the caller already knows (ScanContext).
 */
export async function scanSite(input: string, deps: { fetch: SiteFetch; normalize: NormalizeContext; existing: Existing; maxProducts?: number; progress?: (p: Partial<ImportProgressDto>) => void; platform?: ImportPlatform; skipPage?: (url: string) => boolean }): Promise<ScanOutcome> {
  const start = startUrlOf(input)
  const progress = deps.progress ?? (() => {})
  const maxProducts = Math.min(IMPORT_MAX_PRODUCTS, deps.maxProducts ?? IMPORT_MAX_PRODUCTS)
  progress({ phase: "detect", note: `Reading ${start.hostname}` })
  let home: Home = null
  const homeUrl = `${start.origin}/`
  const notes: string[] = []
  try {
    const page = await deps.fetch.get(homeUrl, { accept: "text/html" })
    home = { url: page.url, html: page.text }
  } catch (e) {
    if (!(e instanceof FetchRefused)) throw e
    if (e.reason === "private" || e.reason === "url" || e.reason === "dns") throw e
    notes.push(`The home page couldn't be read (${e.message})`)
    if (start.pathname !== "/") {
      const page = await deps.fetch.get(start.toString(), { accept: "text/html" })
      home = { url: page.url, html: page.text }
    }
  }
  const ctx = { start, home, fetch: deps.fetch, maxProducts, progress, skipPage: deps.skipPage }
  let last: { platform: ImportPlatform; brand: ImportBrandDto; warnings: string[] } | null = null
  for (const a of deps.platform ? ADAPTERS.filter((x) => x.id === deps.platform) : ADAPTERS) {
    if (!deps.platform && a.detect(ctx) === "no") continue
    const r = await a.scan(ctx)
    if (!r) continue
    last = { platform: a.id, brand: r.brand, warnings: r.warnings }
    if (!r.products.length && !deps.platform) continue
    const products = r.products.map((p) => normalizeProduct(p, deps.normalize)).filter((p): p is ImportProductDto => !!p)
    progress({ phase: "done", productsFound: products.length, note: null })
    return { platform: a.id, startUrl: start.toString(), brand: r.brand, products: markDuplicates(products, deps.existing), warnings: [...notes, ...r.warnings] }
  }
  progress({ phase: "done", productsFound: 0, note: null })
  return { platform: last?.platform ?? "generic", startUrl: start.toString(), brand: last?.brand ?? { name: null, logo: null, banner: null, description: null, socials: { instagram: null, tiktok: null, links: [] } }, products: [], warnings: [...notes, ...(last?.warnings ?? []), "No products were found on this site."] }
}
