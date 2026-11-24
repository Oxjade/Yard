import { api } from "./client"
import type { AdminWatchDto, ImportedStockDto, ImportDetailDto, ImportListDto, ImportRunBody, ImportScanBody, StudioSitePiecesDto } from "./contracts/imports"

/** Typed wrappers over /api/admin/brand-imports (Import from website, docs/IMPORTER.md). */

const BASE = "/api/admin/brand-imports"
const one = (id: string) => `${BASE}/${encodeURIComponent(id)}`

export const listBrandImports = (brandId: string) => api<ImportListDto>(BASE, { query: { brandId } })
export const getBrandImport = (id: string) => api<{ import: ImportDetailDto }>(one(id))
export const startBrandImportScan = (body: ImportScanBody) => api<{ import: ImportDetailDto }>(BASE, { body })
export const runBrandImport = (id: string, body: ImportRunBody) => api<{ import: ImportDetailDto }>(`${one(id)}/import`, { body })

export const brandImportsKey = (brandId: string) => `admin.brand_imports:${brandId}`
export const brandImportKey = (id: string) => `admin.brand_import:${id}`

/* ---------- watching a website ---------- */

export const getBrandWatch = (brandId: string) => api<AdminWatchDto>("/api/admin/brand-watch", { query: { brandId } })
export const setBrandWatch = (body: { brandId: string; enabled: boolean; importId?: string }) => api<AdminWatchDto>("/api/admin/brand-watch", { method: "PUT", body })
export const checkBrandWatch = (brandId: string, resume?: boolean) => api<AdminWatchDto>("/api/admin/brand-watch/check", { body: resume ? { brandId, resume } : { brandId } })
export const actOnWebsitePiece = (id: string, action: "approve" | "skip" | "dismiss_change") => api<AdminWatchDto>(`/api/admin/website-pieces/${encodeURIComponent(id)}`, { body: { action } })
export const approveAllWebsitePieces = (brandId: string) => api<AdminWatchDto & { taken: number }>("/api/admin/website-pieces", { body: { brandId, action: "approve_all" } })
export const brandWatchKey = (brandId: string) => `admin.brand_watch:${brandId}`

export const listStudioWebsitePieces = () => api<StudioSitePiecesDto>("/api/studio/catalog/website-pieces")
export const actOnStudioWebsitePiece = (id: string, action: "add" | "skip") => api<StudioSitePiecesDto & { productId?: string; published?: boolean }>(`/api/studio/catalog/website-pieces/${encodeURIComponent(id)}`, { body: { action } })
/** Add all (no ids) or the selected pieces in one tap; the same `idempotencyKey` answers with the first result. */
export const addStudioWebsitePieces = (body: { ids?: string[]; idempotencyKey: string }) =>
  api<StudioSitePiecesDto & { accepted: string[]; skipped: { id: string; reason: string }[]; replayed?: boolean }>("/api/studio/catalog/website-pieces/add-all", { body })
export const STUDIO_WEBSITE_PIECES_KEY = "studio.website_pieces"

/* ---------- imported stock: "Mark imported products as available (stock not tracked)" ---------- */

export const previewImportedStock = (brandId: string) => api<ImportedStockDto>("/api/admin/brand-imports/stock", { query: { brandId } })
export const markImportedStockAvailable = (brandId: string) => api<ImportedStockDto>("/api/admin/brand-imports/stock", { body: { brandId } })
