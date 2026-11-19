import "server-only"
import { publishScheduled } from "./jobs"
import { nudgeBrands } from "./nudges"
import { sweepExpiredHolds } from "./stock"
import { runImports } from "./importer/service"

/**
 * CATALOG contract (backend v3). Other areas call exactly these:
 *  - getSellableVariants(variantIds)           live price + availability (joins the ambient tx)
 *  - holdStock(tx, { holdKey, lines, ttlMinutes? })  idempotent per holdKey, default TTL 15 min
 *  - commitHold(tx, holdKey) · releaseHold(tx, holdKey) · restock(tx, { variantId, qty, reason })
 * Scheduler jobs (register in src/server/schedulers.ts as feature "catalog"):
 *  - jobs.publishScheduled   every minute
 *  - jobs.sweepExpiredHolds  every minute
 *  - jobs.nudgeBrands        every 30 minutes (reminder emails to brands, catalog/nudges.ts)
 *  - jobs.runImports         every minute (Import from website: resumes scans and imports, importer/service.ts)
 */
export const IMPL: string = "CATALOG-v3-2026-11-08"

export { getSellableVariants, getProductForSearch } from "./sellable"
export { holdStock, commitHold, releaseHold, restock } from "./stock"
export { MODERATION_BATCH_MAX, setProductModeration, setProductsModeration } from "./jobs"
export { reviewOnboarding, listSubmittedOnboardings } from "./onboarding"
export { publishScheduled, sweepExpiredHolds, nudgeBrands }

export const jobs = { publishScheduled, sweepExpiredHolds, nudgeBrands, runImports: () => runImports() }
