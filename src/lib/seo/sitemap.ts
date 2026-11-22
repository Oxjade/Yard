/**
 * Sitemap XML (sitemaps.org, with Google's image extension). /sitemap.xml is one urlset while Yard
 * has at most 50,000 public URLs; past that it becomes a sitemap index of /sitemaps/<n>.xml parts of
 * 50,000 each. Pure: the server passes the entries in (src/server/seo/catalog.ts).
 */
import { xmlText } from "./feed"

export const SITEMAP_LIMIT = 50_000

export type SitemapEntry = {
  url: string
  lastModified?: string | null
  changeFrequency?: "daily" | "weekly" | "monthly" | "yearly"
  priority?: number
  images?: string[]
}

export function urlsetXml(entries: SitemapEntry[]) {
  const body = entries.map((e) => {
    const parts = [`<loc>${xmlText(e.url)}</loc>`]
    if (e.lastModified) parts.push(`<lastmod>${xmlText(new Date(e.lastModified).toISOString())}</lastmod>`)
    if (e.changeFrequency) parts.push(`<changefreq>${e.changeFrequency}</changefreq>`)
    if (e.priority !== undefined) parts.push(`<priority>${e.priority.toFixed(1)}</priority>`)
    for (const src of (e.images ?? []).slice(0, 10)) parts.push(`<image:image><image:loc>${xmlText(src)}</image:loc></image:image>`)
    return `<url>${parts.join("")}</url>`
  })
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">`,
    ...body,
    `</urlset>`,
    "",
  ].join("\n")
}

export function sitemapIndexXml(parts: { url: string; lastModified?: string | null }[]) {
  const body = parts.map((p) => `<sitemap><loc>${xmlText(p.url)}</loc>${p.lastModified ? `<lastmod>${xmlText(new Date(p.lastModified).toISOString())}</lastmod>` : ""}</sitemap>`)
  return [`<?xml version="1.0" encoding="UTF-8"?>`, `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`, ...body, `</sitemapindex>`, ""].join("\n")
}

/** How many parts the entries need (1 means /sitemap.xml is the urlset itself). */
export const sitemapParts = (count: number) => Math.max(1, Math.ceil(count / SITEMAP_LIMIT))

export const sitemapPart = (entries: SitemapEntry[], part: number) => entries.slice(part * SITEMAP_LIMIT, (part + 1) * SITEMAP_LIMIT)

/** The newest lastModified among entries (a part's lastmod in the index). */
export function newest(entries: SitemapEntry[]) {
  let best: string | null = null
  for (const e of entries) if (e.lastModified && (!best || e.lastModified > best)) best = e.lastModified
  return best
}
