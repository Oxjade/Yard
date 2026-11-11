import { brands } from "./brands"
import { collections, curatedCollections, drops, stories } from "./catalog"
import { products } from "./products"

/**
 * The identities of the bundled sample catalogue (src/lib/data), frozen at module load from the
 * arrays, never from the maps: in the browser src/lib/api/live-catalog.ts adds live products to
 * productById / variantById / brandById, so `productById.has(id)` is not a "this is sample" test.
 *
 * Production (demo switch off) refuses and hides every one of these, whatever reads them: the
 * server guard (src/server/catalog/sample-guard.ts), the public catalogue SQL, the page-exists
 * rule, and the client stores (cart, saved lists, notifications) that may still hold them from an
 * earlier visit. Pure, so both sides can import it.
 */
const frozen = (values: Iterable<string>): ReadonlySet<string> => Object.freeze(new Set(values))

export const SAMPLE_BRAND_IDS = frozen(brands.map((b) => b.id))
export const SAMPLE_BRAND_HANDLES = frozen(brands.map((b) => b.handle))
export const SAMPLE_BRAND_NAMES = frozen(brands.map((b) => b.name))
export const SAMPLE_PRODUCT_IDS = frozen(products.map((p) => p.id))
export const SAMPLE_PRODUCT_SLUGS = frozen(products.map((p) => p.slug))
export const SAMPLE_VARIANT_IDS = frozen(products.flatMap((p) => p.variants.map((v) => v.id)))
export const SAMPLE_DROP_IDS = frozen(drops.map((d) => d.id))
export const SAMPLE_DROP_SLUGS = frozen(drops.map((d) => d.slug))
export const SAMPLE_COLLECTION_IDS = frozen([...collections.map((c) => c.id), ...curatedCollections.map((c) => c.id)])
export const SAMPLE_STORY_SLUGS = frozen(stories.map((s) => s.slug))

const str = (v: unknown): v is string => typeof v === "string" && v.length > 0

/*
 * Identity is the id. Sample ids are fixed words (`b_lagos_static`, `p_wool_beret`, `p_wool_beret_v0`,
 * `d_nf_04`) and a real row's id is `<prefix>_<time><random>` (src/server/ids.ts), so the two can
 * never meet. Handles and slugs are not identities: a real brand may one day pick a word a sample
 * used, so production hides sample handles and slugs through the id (the catalogue SQL), not by name.
 */

/** A sample brand id (`b_lagos_static`). */
export const isSampleBrand = (id: unknown) => str(id) && SAMPLE_BRAND_IDS.has(id)
/** A sample product id (`p_danfo_heavyweight_hoodie`). */
export const isSampleProduct = (id: unknown) => str(id) && SAMPLE_PRODUCT_IDS.has(id)
/** A sample variant id (`p_danfo_heavyweight_hoodie_v0`). */
export const isSampleVariant = (id: unknown) => str(id) && SAMPLE_VARIANT_IDS.has(id)
/** A sample drop id (`d_nf_04`). */
export const isSampleDrop = (id: unknown) => str(id) && SAMPLE_DROP_IDS.has(id)
/** A sample brand collection or curated collection id. */
export const isSampleCollection = (id: unknown) => str(id) && SAMPLE_COLLECTION_IDS.has(id)
/** Any sample id (brand, product, variant, drop or collection), for stores that mix kinds. */
export const isSampleId = (id: unknown) => isSampleBrand(id) || isSampleProduct(id) || isSampleVariant(id) || isSampleDrop(id) || isSampleCollection(id)
