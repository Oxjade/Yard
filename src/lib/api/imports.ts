import { api } from "./client"
import type { ImportDetailDto, ImportListDto, ImportRunBody, ImportScanBody } from "./contracts/imports"

/** Typed wrappers over /api/admin/brand-imports (Import from website, docs/IMPORTER.md). */

const BASE = "/api/admin/brand-imports"
const one = (id: string) => `${BASE}/${encodeURIComponent(id)}`

export const listBrandImports = (brandId: string) => api<ImportListDto>(BASE, { query: { brandId } })
export const getBrandImport = (id: string) => api<{ import: ImportDetailDto }>(one(id))
export const startBrandImportScan = (body: ImportScanBody) => api<{ import: ImportDetailDto }>(BASE, { body })
export const runBrandImport = (id: string, body: ImportRunBody) => api<{ import: ImportDetailDto }>(`${one(id)}/import`, { body })

export const brandImportsKey = (brandId: string) => `admin.brand_imports:${brandId}`
export const brandImportKey = (id: string) => `admin.brand_import:${id}`
