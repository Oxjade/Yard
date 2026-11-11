#!/usr/bin/env node
// Run with the same NODE_ENV and YARD_DATA_DIR as Yard. NODE_ENV defaults to production.
// With PGlite (no DATABASE_URL) stop Yard first: PGlite permits one process per data directory. On Postgres it can run beside the server.
// Opening the database brings it up to THIS checkout's schema (pending migrations and seeds run first,
// as when Yard boots), even on a dry run. Run it from the checkout you are about to deploy.

import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { parseArgs, parseEnv } from "node:util"

const usage = "Usage: npm run maintenance:approved-brand-setup -- [--apply]"
let args
try {
  args = parseArgs({ options: { apply: { type: "boolean", default: false }, help: { type: "boolean", short: "h", default: false } }, strict: true }).values
} catch (error) {
  console.error(`${error.message}\n${usage}`)
  process.exit(2)
}
if (args.help) {
  console.log(`${usage}\nWithout --apply, this only reports the brand changes. --apply commits them in one transaction, with an audit entry per brand.\nEither way, opening the database first applies this checkout's pending migrations and seeds (as Yard's boot does), so run it from the checkout you are about to deploy.\nRun with Yard's NODE_ENV and YARD_DATA_DIR; NODE_ENV defaults to production.`)
  process.exit(0)
}

process.env.NODE_ENV ||= "production"
for (const file of [`.env.${process.env.NODE_ENV}.local`, process.env.NODE_ENV === "test" ? null : ".env.local", `.env.${process.env.NODE_ENV}`, ".env"]) {
  if (!file) continue
  const filePath = path.join(process.cwd(), file)
  if (!existsSync(filePath)) continue
  for (const [key, value] of Object.entries(parseEnv(readFileSync(filePath, "utf8")))) if (process.env[key] === undefined) process.env[key] = value
}
if (process.env.YARD_RESET_DB === "1") {
  console.error("Refusing to run with YARD_RESET_DB=1.")
  process.exit(2)
}
globalThis.__yard = { ...(globalThis.__yard ?? {}), schedulers: true }

let root
try {
  const [{ getDb }, { db, withTx }, schema, { and, asc, desc, eq, isNotNull, lte }, { createStarterShipping }, { onboardingSku }, markets, { writeAudit }] = await Promise.all([
    import("@/server/db/client"),
    import("@/server/db"),
    import("@/server/db/schema"),
    import("drizzle-orm"),
    import("@/server/shipping/profile"),
    import("@/server/catalog/onboarding"),
    import("@/config/markets"),
    import("@/server/audit"),
  ])
  const { brands, brandOnboardings, catalogProducts, catalogVariants, shippingProfiles, shippingZones } = schema
  root = await getDb()
  const d = await db()
  const applications = await d
    .select({
      brand: { id: brands.id, handle: brands.handle, country: brands.country, city: brands.city, currency: brands.currency, reviewStatus: brands.reviewStatus },
      userId: brandOnboardings.userId,
      data: brandOnboardings.data,
      reviewedAt: brandOnboardings.reviewedAt,
    })
    .from(brandOnboardings)
    .innerJoin(brands, eq(brands.id, brandOnboardings.brandId))
    // Approval alone qualifies (as in reviewOnboarding): a brand restricted or suspended since then
    // still needs its profile for when it is reinstated, which doesn't create one.
    .where(and(eq(brandOnboardings.status, "approved"), isNotNull(brandOnboardings.reviewedAt)))
    .orderBy(desc(brandOnboardings.reviewedAt))

  const latestApplication = new Map()
  for (const application of applications) if (!latestApplication.has(application.brand.id)) latestApplication.set(application.brand.id, application)

  const [profileRows, zoneRows] = await Promise.all([
    d.select({ brandId: shippingProfiles.brandId }).from(shippingProfiles),
    d.select({ brandId: shippingZones.brandId }).from(shippingZones),
  ])
  const existingProfiles = new Set(profileRows.map((row) => row.brandId))
  const brandsWithZones = new Set(zoneRows.map((row) => row.brandId))
  const shippingPlans = []
  const profileSkips = []

  for (const application of latestApplication.values()) {
    const { brand, data } = application
    if (existingProfiles.has(brand.id)) continue
    if (brandsWithZones.has(brand.id)) {
      profileSkips.push(`${brand.handle}: zone rows exist without a profile`)
      continue
    }
    if (!(brand.currency in markets.currencies)) {
      profileSkips.push(`${brand.handle}: unsupported currency ${brand.currency}`)
      continue
    }
    const payments = data?.payments && typeof data.payments === "object" ? data.payments : {}
    const min = payments.processingMin
    const max = payments.processingMax
    const validHandling = Number.isInteger(min) && Number.isInteger(max) && min >= 0 && max <= 60 && max >= min
    const delivery = Array.isArray(payments.delivery) ? payments.delivery.filter((zone) => ["domestic", "regional", "international"].includes(zone)) : []
    shippingPlans.push({
      brand,
      options: { handling: validHandling ? [min, max] : [1, 3], delivery: delivery.length ? delivery : ["domestic"] },
    })
  }

  const skuPlans = []
  const skuSkips = []
  for (const application of latestApplication.values()) {
    const { brand, userId, reviewedAt } = application
    const [product] = await d
      .select({ id: catalogProducts.id, title: catalogProducts.title })
      .from(catalogProducts)
      .where(and(eq(catalogProducts.brandId, brand.id), eq(catalogProducts.createdBy, userId), lte(catalogProducts.createdAt, reviewedAt)))
      .orderBy(asc(catalogProducts.createdAt))
      .limit(1)
    if (!product) continue
    const variants = await d
      .select({ id: catalogVariants.id, sku: catalogVariants.sku, options: catalogVariants.options })
      .from(catalogVariants)
      .where(eq(catalogVariants.productId, product.id))
    const longVariants = variants.filter((variant) => variant.sku.length > 40)
    if (!longVariants.length) continue
    const proposals = longVariants.map((variant) => ({
      ...variant,
      nextSku: onboardingSku(brand.handle, product.title, variant.options.Size ?? "variant"),
    }))
    const targets = new Set(proposals.map((proposal) => proposal.nextSku))
    const targetIds = new Set(proposals.map((proposal) => proposal.id))
    const allBrandVariants = await d
      .select({ id: catalogVariants.id, sku: catalogVariants.sku })
      .from(catalogVariants)
      .where(eq(catalogVariants.brandId, brand.id))
    const collision = targets.size !== proposals.length || allBrandVariants.some((variant) => targets.has(variant.sku) && !targetIds.has(variant.id))
    if (collision) {
      skuSkips.push(`${brand.handle}: shortened onboarding SKUs collide with another variant`)
      continue
    }
    skuPlans.push({ brand, product, variants: proposals })
  }

  console.log(`Mode: ${args.apply ? "APPLY" : "DRY RUN"}`)
  console.log(`Starter shipping profiles to create: ${shippingPlans.length}`)
  const standing = (brand) => (brand.reviewStatus === "verified" ? "" : `, currently ${brand.reviewStatus}`)
  for (const plan of shippingPlans) console.log(`  ${plan.brand.handle} (${plan.brand.id}${standing(plan.brand)})`)
  console.log(`Onboarding SKU groups to shorten: ${skuPlans.length}`)
  for (const plan of skuPlans) {
    console.log(`  ${plan.brand.handle} / ${plan.product.id}${standing(plan.brand) ? ` (${standing(plan.brand).slice(2)})` : ""}`)
    for (const variant of plan.variants) console.log(`    ${variant.sku} -> ${variant.nextSku}`)
  }
  for (const skip of [...profileSkips, ...skuSkips]) console.log(`SKIP ${skip}`)

  if (args.apply && (shippingPlans.length || skuPlans.length)) {
    await withTx(async (tx) => {
      for (const plan of shippingPlans) await createStarterShipping(plan.brand, plan.options)
      // One audit entry per brand, so a merchant's audit trail explains the new profile and SKUs.
      const changedBrands = new Map()
      for (const plan of shippingPlans) changedBrands.set(plan.brand.id, { brand: plan.brand, starterShipping: { handling: plan.options.handling, delivery: plan.options.delivery }, skus: [] })
      for (const plan of skuPlans) {
        const entry = changedBrands.get(plan.brand.id) ?? { brand: plan.brand, starterShipping: null, skus: [] }
        for (const variant of plan.variants) entry.skus.push({ variantId: variant.id, from: variant.sku, to: variant.nextSku })
        changedBrands.set(plan.brand.id, entry)
      }
      for (const { brand, starterShipping, skus } of changedBrands.values()) {
        await writeAudit({
          actor: { kind: "system", name: "Maintenance script" },
          action: "maintenance.approved_brand_setup",
          target: brand.handle,
          subjectType: "brand",
          subjectId: brand.id,
          brandId: brand.id,
          meta: { starterShipping, skus },
        })
      }
      for (const plan of skuPlans) {
        for (const variant of plan.variants) {
          await tx.update(catalogVariants).set({ sku: `__tmp_${crypto.randomUUID().replaceAll("-", "")}` }).where(eq(catalogVariants.id, variant.id))
        }
        for (const variant of plan.variants) {
          await tx.update(catalogVariants).set({ sku: variant.nextSku, updatedAt: new Date() }).where(eq(catalogVariants.id, variant.id))
        }
      }
    })
    console.log("Changes committed.")
  } else if (args.apply) {
    console.log("No changes needed.")
  } else {
    console.log("No data changed. Review this report, then rerun with --apply to commit.")
  }
} catch (error) {
  console.error(`Maintenance script failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  try {
    if (root) await (await import("@/server/db/client")).closeDb()
  } catch {
    // The database lock is released on process exit.
  }
}