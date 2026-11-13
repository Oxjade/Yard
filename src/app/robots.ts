import type { MetadataRoute } from "next"
import { connection } from "next/server"

const origin = () => (process.env.YARD_PUBLIC_URL?.trim() || "http://localhost:3000").replace(/\/$/, "")

/** /robots.txt: the shop is crawlable; accounts, Studio, the Control Center and the API are not. */
export default async function robots(): Promise<MetadataRoute.Robots> {
  // Read at request time: the public address comes from the server's environment, not the build's.
  await connection()
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/studio", "/api/", "/auth/", "/you", "/bag", "/checkout", "/inbox", "/notifications", "/wishlist", "/following", "/welcome", "/unsubscribe", "/dev", "/vendor"] }],
    sitemap: `${origin()}/sitemap.xml`,
    host: origin(),
  }
}
