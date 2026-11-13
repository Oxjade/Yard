import type { MetadataRoute } from "next"
import { connection } from "next/server"
import { listPublicBrands, listPublicProducts } from "@/server/catalog/public"
import { log } from "@/server/log"

const origin = () => (process.env.YARD_PUBLIC_URL?.trim() || "http://localhost:3000").replace(/\/$/, "")

const pages: { path: string; priority: number; changeFrequency: "daily" | "weekly" | "monthly" | "yearly" }[] = [
  { path: "/", priority: 1, changeFrequency: "daily" },
  { path: "/shop", priority: 0.9, changeFrequency: "daily" },
  { path: "/brands", priority: 0.9, changeFrequency: "daily" },
  { path: "/drops", priority: 0.8, changeFrequency: "daily" },
  { path: "/categories", priority: 0.7, changeFrequency: "weekly" },
  { path: "/charts", priority: 0.6, changeFrequency: "weekly" },
  { path: "/around", priority: 0.6, changeFrequency: "weekly" },
  { path: "/sell", priority: 0.8, changeFrequency: "monthly" },
  { path: "/support", priority: 0.4, changeFrequency: "monthly" },
  { path: "/legal/terms", priority: 0.2, changeFrequency: "yearly" },
  { path: "/legal/privacy", priority: 0.2, changeFrequency: "yearly" },
  { path: "/legal/refunds", priority: 0.2, changeFrequency: "yearly" },
  { path: "/legal/seller-agreement", priority: 0.2, changeFrequency: "yearly" },
]

/** /sitemap.xml: the public pages plus every listed brand and product, read when a crawler asks. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection()
  const base = origin()
  const out: MetadataRoute.Sitemap = pages.map((p) => ({ url: `${base}${p.path}`, changeFrequency: p.changeFrequency, priority: p.priority }))
  try {
    for (let offset: number | null = 0, n = 0; offset !== null && n < 20; n++) {
      const page = await listPublicBrands({ sort: "name", limit: 60, offset })
      for (const b of page.brands) out.push({ url: `${base}/brands/${b.handle}`, changeFrequency: "weekly", priority: 0.8 })
      offset = page.nextOffset
    }
    for (let offset: number | null = 0, n = 0; offset !== null && n < 50; n++) {
      const page = await listPublicProducts({ sort: "new", limit: 60, offset })
      for (const p of page.products) out.push({ url: `${base}/products/${p.slug}`, changeFrequency: "weekly", priority: 0.7 })
      offset = page.nextOffset
    }
  } catch (e) {
    log.error("[yard] sitemap: catalogue read failed", e)
  }
  return out
}
