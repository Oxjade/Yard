import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { connection } from "next/server"
import { ImportFromWebsiteRoute } from "@/components/admin/importer/import-page"

export const metadata: Metadata = { title: "Import from website" }
/** Imports live on the server, read per request: nothing to prerender. */
export const instant = false

/**
 * Admin › Brands › {brand} › Import from website (docs/IMPORTER.md): scan the brand's own shop,
 * review the products, send them as Suggestions from Yard. ?import=<id> resumes a job.
 */
export default async function AdminBrandImportPage({ params }: PageProps<"/admin/brands/[id]/import">) {
  await connection()
  const { id } = await params
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) notFound()
  return <ImportFromWebsiteRoute brandId={id} />
}
