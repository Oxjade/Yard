import type { ImportBrandDto, ImportPlatform, ImportProgressDto } from "@/lib/api/contracts/imports"
import type { RawProduct } from "../normalize"

/**
 * The adapter contract. An adapter reads one kind of shop through the site fetcher (polite, capped,
 * SSRF-safe: scan.ts builds it on fetch.ts) and returns the brand and its products in the site's
 * own terms; normalize.ts turns them into Yard's shape. Adapters never touch the database.
 */

export type Page = { url: string; status: number; contentType: string; text: string }

export type SiteFetch = {
  /** GET one URL as text. Throws FetchRefused (fetch.ts) on refusal, a non-2xx answer or a timeout. */
  get(url: string, opts?: { accept?: string }): Promise<Page>
  /** GET and parse JSON; null when the answer isn't JSON (a catch-all HTML page, say). */
  json<T = unknown>(url: string): Promise<T | null>
}

export type Home = { url: string; html: string } | null

export type ScanContext = {
  /** The cleaned address the admin pasted. */
  start: URL
  /** The site's home page (or the pasted page when the home page failed). */
  home: Home
  fetch: SiteFetch
  maxProducts: number
  progress(p: Partial<ImportProgressDto>): void
}

export type AdapterResult = { brand: ImportBrandDto; products: RawProduct[]; warnings: string[] }

export type Adapter = {
  id: ImportPlatform
  /** "yes": this is the platform; "no": certainly not (skip without a request); "maybe": probe. */
  detect(ctx: ScanContext): "yes" | "no" | "maybe"
  /** Null when the site isn't this platform after all. */
  scan(ctx: ScanContext): Promise<AdapterResult | null>
}

/** Runs `fn` over items with at most `n` at a time (the fetcher spaces the requests themselves). */
export async function eachLimit<T>(items: T[], n: number, fn: (item: T, i: number) => Promise<void>) {
  let next = 0
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      await fn(items[i], i)
    }
  })
  await Promise.all(workers)
}
