import "server-only"
import { sql, type SQL, type AnyColumn } from "drizzle-orm"
import { isSampleBrand, isSampleDrop, isSampleProduct, isSampleVariant, SAMPLE_BRAND_IDS } from "@/lib/data/sample-ids"
import { getEnv } from "../env"
import { badRequest, notFound } from "../http/errors"

/**
 * Production refuses the bundled sample catalogue by identity, not only by its absence from the
 * database: sample ids are deterministic (`b_lagos_static`, `p_*`, `p_*_v0`, `d_*`), so a database
 * that was ever booted with YARD_SEED_DEMO=1 would otherwise accept them. Demo and development
 * (getEnv().seedDemo) keep every sample path exactly as before.
 *
 * Refusals are a clear 4xx with the same wording an unknown id gets: 404 for single-id endpoints,
 * a 400 field error where the endpoint already reports per-field errors.
 */
export const sampleOff = () => !getEnv().seedDemo

export const SAMPLE_PIECE_MESSAGE = "That piece isn't on Yard."
export const SAMPLE_BRAND_MESSAGE = "That brand isn't on Yard."
export const SAMPLE_DROP_MESSAGE = "That drop isn't on Yard."

/** True when `id` is a sample product, variant, brand or drop id and production refuses it. */
export const refusedSampleProduct = (id: unknown) => sampleOff() && isSampleProduct(id)
export const refusedSampleVariant = (id: unknown) => sampleOff() && isSampleVariant(id)
export const refusedSampleBrand = (id: unknown) => sampleOff() && isSampleBrand(id)
export const refusedSampleDrop = (id: unknown) => sampleOff() && isSampleDrop(id)

/** Throws 404 (or, with `field`, a 400 naming it) for a sample product id in production. */
export function refuseSampleProduct(id: unknown, field?: string) {
  if (refusedSampleProduct(id)) throw field ? badRequest({ [field]: SAMPLE_PIECE_MESSAGE }, SAMPLE_PIECE_MESSAGE) : notFound(SAMPLE_PIECE_MESSAGE)
}

export function refuseSampleVariant(id: unknown, field?: string) {
  if (refusedSampleVariant(id)) throw field ? badRequest({ [field]: SAMPLE_PIECE_MESSAGE }, SAMPLE_PIECE_MESSAGE) : notFound(SAMPLE_PIECE_MESSAGE)
}

export function refuseSampleBrand(id: unknown, field?: string) {
  if (refusedSampleBrand(id)) throw field ? badRequest({ [field]: SAMPLE_BRAND_MESSAGE }, SAMPLE_BRAND_MESSAGE) : notFound(SAMPLE_BRAND_MESSAGE)
}

export function refuseSampleDrop(id: unknown, field?: string) {
  if (refusedSampleDrop(id)) throw field ? badRequest({ [field]: SAMPLE_DROP_MESSAGE }, SAMPLE_DROP_MESSAGE) : notFound(SAMPLE_DROP_MESSAGE)
}

/**
 * A brand Yard has approved (review_status 'verified'). New brands start as 'pending_review' and
 * stay off every public surface (storefront, /brands, /shop, search, sitemap, feeds, llms.txt,
 * charts, the homepage) until an admin approves them; restricted and suspended brands are out too.
 * The demo keeps its bundled sample brands as seeded (two of them are 'pending_review' sample
 * applications), so only real brands need the approval there.
 */
export const demoSampleBrand = (id: unknown) => !sampleOff() && isSampleBrand(id)
export const brandApproved = (b: { id?: string | null; reviewStatus: string }) => b.reviewStatus === "verified" || demoSampleBrand(b.id)

/** SQL for brandApproved: `status` is the brand's review_status, `id` its id. */
export function brandApprovedSql(status: AnyColumn | SQL, id: AnyColumn | SQL): SQL {
  if (sampleOff()) return sql`${status} = 'verified'`
  return sql`(${status} = 'verified' or ${id} in (${sql.join(
    [...SAMPLE_BRAND_IDS].map((x) => sql`${x}`),
    sql`, `,
  )}))`
}

/**
 * SQL: `column` is not a sample brand id, in production; always true in demo. The one rule behind
 * every public catalogue read (sellable.ts productPublicWhere / brandListedSql), so a demo-seeded
 * database can't leak sample brands, products, collections or drops into production.
 */
export function notSampleBrandSql(column: AnyColumn | SQL): SQL {
  if (!sampleOff()) return sql`true`
  const ids = [...SAMPLE_BRAND_IDS]
  return sql`${column} not in (${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )})`
}
