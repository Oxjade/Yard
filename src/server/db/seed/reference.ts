import "server-only"
import { sql } from "drizzle-orm"
import { holidayRows } from "@/config/holidays"
import { categories } from "@/lib/data/catalog"
import { holidays } from "../schema"
import { catalogCategories } from "../schema/catalog"
import { db } from "../tx"
import type { SeedModule } from "./types"

const excluded = (column: string) => sql.raw(`excluded.${column}`)

/**
 * seed:reference — the platform reference data every environment needs, production included
 * (it runs whatever YARD_SEED_DEMO says):
 *  - the category taxonomy (catalog_categories). Studio product create, brand onboarding and the
 *    public category list all check against it, so without it no brand can list anything.
 *  - the public-holiday calendar (holidays, Appendix B) that every delivery estimate reads.
 * Nothing here is sample data: no people, brands, products, orders or activity. seed:catalog and
 * seed:shipping still write the same rows for the demo (both idempotent), so a demo database is
 * unchanged. Categories are upserted from src/lib/data/catalog; holidays are only added.
 */
const seed: SeedModule = {
  key: "seed:reference",
  version: 1,
  async run() {
    const d = await db()
    await d
      .insert(catalogCategories)
      .values(categories.map((c, position) => ({ slug: c.slug, name: c.name, description: c.description, imagePath: c.image.src, subcategories: [...c.subcategories], position })))
      .onConflictDoUpdate({ target: catalogCategories.slug, set: { name: excluded("name"), description: excluded("description"), imagePath: excluded("image_path"), subcategories: excluded("subcategories"), position: excluded("position") } })
    await d.insert(holidays).values(holidayRows()).onConflictDoNothing()
  },
}

export default seed
