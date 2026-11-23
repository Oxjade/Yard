import "server-only"
import type { AdminBrandsDto, AdminBrandsQuery } from "@/lib/api/contracts/admin-brands"
import { db } from "../db"
import { listAdminBrandsDb, type Db } from "./brands-directory-db"

/** Admin › Brands › All brands: every brand in the brands table, a page at a time (brands-directory-db.ts). */
export async function listAdminBrands(query: AdminBrandsQuery): Promise<AdminBrandsDto> {
  return listAdminBrandsDb((await db()) as unknown as Db, query)
}
