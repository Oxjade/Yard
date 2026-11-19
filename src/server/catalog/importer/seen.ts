import "server-only"
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import type { ImportProductDto } from "@/lib/api/contracts/imports"
import { db } from "../../db"
import { catalogImportItems, catalogImports, catalogSitePieces } from "../../db/schema/imports"
import { newId } from "../../ids"
import { urlKey } from "./normalize"
import { baselineOf } from "./watch-rules"

/**
 * The "seen" list for website watching (catalog_site_pieces, docs/IMPORTER.md › Watching a website).
 * An import records every product its scan found: the ones it created as imported (with the
 * suggestion, and the price and availability as the baseline for "Changes on their site"), every
 * other one (unticked, a duplicate, failed) as ignored, so a watch never offers it as new. A
 * product created later by another import is upgraded to imported; an ignored or skipped one never
 * becomes new again.
 */

export async function recordImportSeen(importId: string) {
  const d = await db()
  const [r] = await d.select().from(catalogImports).where(eq(catalogImports.id, importId)).limit(1)
  if (!r) return { imported: 0, ignored: 0 }
  const found = (r.found ?? []) as unknown as ImportProductDto[]
  if (!found.length) return { imported: 0, ignored: 0 }
  const items = await d.select().from(catalogImportItems).where(eq(catalogImportItems.importId, r.id))
  const byKey = new Map(items.map((i) => [i.key, i]))
  const now = new Date()
  let imported = 0
  let ignored = 0
  for (const p of found) {
    const it = byKey.get(p.key)
    const created = it?.status === "created"
    const base = { brandId: r.brandId, urlKey: urlKey(p.sourceUrl), sourceUrl: p.sourceUrl, sourceId: p.sourceId, title: (it?.title ?? p.title).slice(0, 200), origin: "import" as const, baseline: baselineOf(p), lastSeenAt: now, updatedAt: now }
    if (created) {
      imported++
      await d
        .insert(catalogSitePieces)
        .values({ id: newId("sp"), ...base, status: "imported", proposalId: it!.proposalId, firstSeenAt: now })
        .onConflictDoUpdate({ target: [catalogSitePieces.brandId, catalogSitePieces.urlKey], set: { status: "imported", proposalId: it!.proposalId, baseline: base.baseline, title: base.title, reason: null, change: null, product: null, leaseUntil: null, lastSeenAt: now, updatedAt: now } })
    } else {
      ignored++
      const reason = it?.reason === "Not ticked." || !it ? "Not ticked at import." : `Not imported: ${it.reason ?? it.status}`.slice(0, 300)
      await d
        .insert(catalogSitePieces)
        .values({ id: newId("sp"), ...base, status: "ignored", reason, firstSeenAt: now })
        .onConflictDoNothing({ target: [catalogSitePieces.brandId, catalogSitePieces.urlKey] })
    }
  }
  return { imported, ignored }
}

/**
 * When watching starts: every earlier import of the brand (oldest first, so the newest outcome
 * wins), including a scan that was never imported (all of it is then seen and passed over).
 */
export async function seedFromImports(brandId: string) {
  const d = await db()
  const rows = await d
    .select({ id: catalogImports.id })
    .from(catalogImports)
    .where(and(eq(catalogImports.brandId, brandId), inArray(catalogImports.status, ["scanned", "done"])))
    .orderBy(desc(catalogImports.createdAt))
    .limit(20)
  for (const r of rows.reverse()) await recordImportSeen(r.id)
  return rows.length
}

/** How many pieces Yard has seen for the brand. */
export async function seenCount(brandId: string) {
  const d = await db()
  const [r] = await d.select({ n: sql<number>`count(*)::int` }).from(catalogSitePieces).where(eq(catalogSitePieces.brandId, brandId))
  return Number(r?.n ?? 0)
}

/** Everything seen for a brand, as the watch rules compare it. */
export async function knownPieces(brandId: string) {
  const d = await db()
  return d
    .select({ id: catalogSitePieces.id, urlKey: catalogSitePieces.urlKey, sourceId: catalogSitePieces.sourceId, status: catalogSitePieces.status, baseline: catalogSitePieces.baseline, change: catalogSitePieces.change })
    .from(catalogSitePieces)
    .where(eq(catalogSitePieces.brandId, brandId))
    .orderBy(asc(catalogSitePieces.firstSeenAt))
}
