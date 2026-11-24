import "server-only"
import type { ImportedStockDto } from "@/lib/api/contracts/imports"
import { writeAudit } from "../../audit"
import type { AdminActor } from "../../auth/dal"
import { db, withTx } from "../../db"
import { catalogChanged } from "../hooks"
import { applyImportedStock, planImportedStock, type Db, type ImportedStockPlan } from "./imported-stock-db"
import { assertMayImport, loadBrand } from "./service"

/*
 * Admin › Brands › Products › "Mark imported products as available (stock not tracked)"
 * (imported-stock-db.ts has the rules). GET is the preview the confirmation shows; POST applies it.
 * Same permission as importing (catalog.propose, plus brands.founding for an unclaimed founding
 * brand). Audited catalog.imported_stock_untracked. Sizes that come back send back-in-stock alerts.
 */

const dto = (name: string, plan: ImportedStockPlan, changed?: { variants: number; products: number }): ImportedStockDto => ({
  brandName: name,
  platforms: plan.platforms,
  imported: plan.imported,
  products: changed?.products ?? plan.products.length,
  variants: changed?.variants ?? plan.variants.length,
  skipped: plan.skipped,
})

export async function previewImportedStock(admin: AdminActor, brandId: string): Promise<ImportedStockDto> {
  const d = await db()
  const b = await loadBrand(d, brandId)
  assertMayImport(admin, b)
  return dto(b.name, await planImportedStock(d as unknown as Db, b.id))
}

export async function markImportedStockAvailable(admin: AdminActor, brandId: string, ipHash: string | null): Promise<ImportedStockDto> {
  return withTx(async (tx) => {
    const b = await loadBrand(tx, brandId)
    assertMayImport(admin, b)
    const plan = await planImportedStock(tx as unknown as Db, b.id)
    const done = await applyImportedStock(tx as unknown as Db, b.id, plan)
    if (done.variants.length) {
      await writeAudit({
        actor: { kind: "admin", id: admin.userId, name: admin.name, role: admin.role },
        action: "catalog.imported_stock_untracked",
        target: b.name,
        subjectType: "brand",
        subjectId: b.id,
        brandId: b.id,
        ipHash,
        meta: { products: done.products.length, variants: done.variants.length, platforms: plan.platforms, skipped: plan.skipped },
      })
      // Every one of these was at 0: each is "back in stock" for anyone waiting on it.
      catalogChanged({ products: done.products, variants: done.variants, restocked: done.variants })
    }
    return dto(b.name, plan, { variants: done.variants.length, products: done.products.length })
  })
}
