import { and, eq, isNull, sql } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import { catalogImports } from "../db/schema/imports"

/**
 * The two writes "Create brand from website" adds to the importer's own tables (from-website.ts).
 * No server-only, so the tests run these exact statements on PGlite with the migrations.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any drizzle Postgres database or transaction (PGlite, node-postgres)
type Db = PgDatabase<PgQueryResultHKT, any>

/**
 * Gives a brand-less scan its new brand: one conditional UPDATE, so a scan is only ever used for
 * one brand. Repeating it for the same brand is a no-op that succeeds (a retried Create store);
 * another brand is refused with the brand that has it.
 */
export async function attachImport(d: Db, q: { importId: string; brandId: string }): Promise<{ ok: true } | { ok: false; brandId: string | null }> {
  const [row] = await d
    .update(catalogImports)
    .set({ brandId: q.brandId, updatedAt: new Date() })
    .where(and(eq(catalogImports.id, q.importId), isNull(catalogImports.brandId)))
    .returning({ id: catalogImports.id })
  if (row) return { ok: true }
  const [cur] = await d.select({ brandId: catalogImports.brandId }).from(catalogImports).where(eq(catalogImports.id, q.importId)).limit(1)
  return cur?.brandId === q.brandId ? { ok: true } : { ok: false, brandId: cur?.brandId ?? null }
}

/**
 * The logo and banner the admin chose from the site's images become the scan's site logo and
 * banner, so the importer's own storefront-draft step copies those. Only before the import starts.
 */
export async function chooseSiteImages(d: Db, q: { importId: string; logo: string | null; banner: string | null }) {
  const patch = JSON.stringify({ logo: q.logo, banner: q.banner })
  const rows = await d
    .update(catalogImports)
    .set({ brand: sql`coalesce(${catalogImports.brand}, '{}'::jsonb) || ${patch}::jsonb` })
    .where(and(eq(catalogImports.id, q.importId), eq(catalogImports.status, "scanned")))
    .returning({ id: catalogImports.id })
  return rows.length > 0
}
