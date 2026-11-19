import type { Metadata } from "next"
import { connection } from "next/server"
import { FromWebsiteRoute } from "@/components/admin/importer/from-website-page"

export const metadata: Metadata = { title: "Create brand from website" }
/** Scans live on the server, read per request: nothing to prerender. */
export const instant = false

/**
 * Admin › Brands › Founding › Create brand from website (docs/IMPORTER.md): paste a brand's site,
 * check what Yard found, Create store, send the claim link. ?import=<id> resumes a job.
 */
export default async function AdminFoundingFromWebsitePage() {
  await connection()
  return <FromWebsiteRoute />
}
