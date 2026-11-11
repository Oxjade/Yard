import "server-only"
import { chmodSync, copyFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { sql } from "drizzle-orm"
import { adminTeam, brandApplications, platformUsers } from "@/lib/data/admin"
import { brandById } from "@/lib/data/brands"
import { drops } from "@/lib/data/catalog"
import { img } from "@/lib/data/media"
import { customerOrders, merchantOrders, shoppers } from "@/lib/data/orders"
import { products } from "@/lib/data/products"
import { hash, pick, rand, randInt } from "@/lib/data/seed"
import { getEnv } from "../../env"
import { log } from "../../log"
import type { Root } from "../client"
import { appMeta, brands as brandRows } from "../schema"
import { SAMPLE_BRAND_IDS } from "@/lib/data/sample-ids"
import { db, runTx, withTx } from "../tx"
import type { SeedContext, SeedModule } from "./types"
import people from "./people"
import brands from "./brands"
import orders from "./orders"
import around from "./around"
import shipping from "./shipping"
import delivery from "./delivery"
import social from "./social"
import inbox from "./inbox"
import safety from "./safety"
import charts from "./charts"
import reference from "./reference"
import catalog from "../../catalog/seed"
import dropsSeed from "../../drops/seed"
import { catalogProducts } from "../schema/catalog"

export type { SeedContext, SeedModule } from "./types"

/**
 * Reference data the platform needs in every environment, production included: the category
 * taxonomy and the holiday calendar. Always seeded, whatever YARD_SEED_DEMO says.
 */
export const referenceModules: SeedModule[] = [reference]

/**
 * Demo fixtures: sample people, brands, the sample catalogue, drops, orders, places, shipping
 * profiles, delivery, social posts, inbox, safety reports and the charts ring. Seeded only when
 * seedDemo (development, test, or YARD_SEED_DEMO=1 on an isolated demo deployment).
 * The run order (§1.5): `around` runs before `shipping` (Lagos Static's pickup point).
 */
export const demoModules: SeedModule[] = [people, brands, catalog, dropsSeed, orders, around, shipping, delivery, social, inbox, safety, charts]

/** Every module, in run order: reference data first, then the demo fixtures. */
export const seedModules: SeedModule[] = [...referenceModules, ...demoModules]

const SEED_DAY_KEY = "seed:day"

async function recordedVersions(): Promise<Record<string, number>> {
  const d = await db()
  const rows = await d.select().from(appMeta)
  const out: Record<string, number> = {}
  for (const r of rows) {
    const v = r.value as { version?: number }
    if (r.key.startsWith("seed:") && typeof v?.version === "number") out[r.key] = v.version
  }
  return out
}

async function seedDay(): Promise<string> {
  const d = await db()
  const row = await d.query.appMeta.findFirst({ where: (m, { eq }) => eq(m.key, SEED_DAY_KEY) })
  const existing = (row?.value as { day?: string } | undefined)?.day
  if (existing) return existing
  const day = new Date().toISOString().slice(0, 10)
  await d.insert(appMeta).values({ key: SEED_DAY_KEY, value: { day } }).onConflictDoNothing()
  return day
}

function copyPrivateFixture(publicPath: string, purpose: string, ownerId: string, fileName?: string) {
  if (!/^\/media\/[\w./-]+$/.test(publicPath) || publicPath.includes("..")) throw new Error(`copyPrivateFixture: ${publicPath} is not a /media path`)
  if (!/^[a-z_]+$/.test(purpose) || !/^[\w-]+$/.test(ownerId)) throw new Error("copyPrivateFixture: bad purpose or owner")
  const name = fileName ?? path.basename(publicPath)
  if (!/^[\w.-]+$/.test(name)) throw new Error("copyPrivateFixture: bad file name")
  const rel = path.posix.join(purpose, ownerId, name)
  const dest = path.join(getEnv().envDir, "uploads", rel)
  mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 })
  copyFileSync(path.join(process.cwd(), "public", publicPath), dest)
  // copyFile keeps the public file's mode (0644) whatever the umask: private uploads are 0600.
  chmodSync(dest, 0o600)
  return rel
}

async function context(): Promise<SeedContext> {
  return {
    seedDay: await seedDay(),
    now: new Date(),
    rand,
    hash,
    pick,
    randInt,
    brandById,
    products,
    drops,
    merchantOrders,
    customerOrders,
    shoppers,
    platformUsers,
    adminTeam,
    brandApplications,
    img,
    copyPrivateFixture,
  }
}

/** The first requirement ('<table>:<id>') that isn't seeded yet, or null. */
async function missingRequirement(m: SeedModule): Promise<string | null> {
  const d = await db()
  for (const req of m.requires ?? []) {
    const [table, id] = req.split(":")
    if (!/^[a-z_]+$/.test(table ?? "") || !id) throw new Error(`${m.key}: bad requirement ${req}`)
    const r = await d.execute(sql`select 1 from ${sql.identifier(table)} where id = ${id} limit 1`)
    if (!r.rows.length) return req
  }
  return null
}

async function record(m: SeedModule) {
  const d = await db()
  const value = { version: m.version, ranAt: new Date().toISOString() }
  await d.insert(appMeta).values({ key: m.key, value }).onConflictDoUpdate({ target: appMeta.key, set: { value, updatedAt: new Date() } })
}

/**
 * Boot: runs every module whose recorded version is below its own, each in its own transaction.
 * A failing or waiting module is logged and skipped, so a wave-2 seed can't break boot.
 */
export async function runSeeds(root: Root) {
  const env = getEnv()
  const modules = env.seedDemo ? seedModules : referenceModules
  const versions = await runTx(root, () => recordedVersions())
  const ctx = await runTx(root, () => context())
  for (const m of modules) {
    if (m.version <= 0 || (versions[m.key] ?? 0) >= m.version) continue
    const started = Date.now()
    try {
      const ran = await runTx(root, async () => {
        const missing = await missingRequirement(m)
        if (missing) {
          log.info(`[yard] ${m.key} waiting for ${missing}`)
          return false
        }
        await m.run(ctx)
        await record(m)
        return true
      })
      if (ran) log.info(`[yard] ${m.key} v${m.version} seeded in ${Date.now() - started} ms`)
    } catch (e) {
      log.error(`[yard] ${m.key} failed; it will retry at the next boot or reseed`, e)
    }
  }
  if (!env.seedDemo) await warnEmptyCatalogue(root)
}

/**
 * Demo seeding off (production only: development and test always seed the demo fixtures), so
 * only reference data was seeded. The public shop reads only the server catalogue in production
 * (the bundled sample catalogue in src/lib/data is never shown, linked or sold), so an empty
 * server catalogue means empty states everywhere until brands list products. Say so at boot, and
 * warn loudly when sample rows are present (a database once booted with YARD_SEED_DEMO=1): they
 * stay hidden from every public read (sample-guard.ts) but should be cleaned up.
 */
async function warnEmptyCatalogue(root: Root) {
  let products = 0
  let sampleRows = 0
  try {
    const [row] = await runTx(root, async () => (await db()).select({ n: sql<number>`count(*)::int` }).from(catalogProducts))
    products = row?.n ?? 0
    const ids = [...SAMPLE_BRAND_IDS]
    const [hit] = await runTx(root, async () =>
      (await db())
        .select({ n: sql<number>`count(*)::int` })
        .from(brandRows)
        .where(
          sql`${brandRows.id} in (${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        ),
    )
    sampleRows = hit?.n ?? 0
  } catch (e) {
    log.error("[yard] could not count catalogue products", e)
    return
  }
  if (sampleRows > 0) {
    log.warn(
      [
        "[yard] ************************************************************************************",
        `[yard] WARNING: demo seeding is off but ${sampleRows} SAMPLE brand row(s) (b_lagos_static, …) are in this database.`,
        "[yard] They are hidden from every public page, list, search and API and refused by cart,",
        "[yard] checkout, wishlist and follows, but this database was once booted with YARD_SEED_DEMO=1.",
        "[yard] ************************************************************************************",
      ].join("\n"),
    )
  }
  if (products > 0) return
  const lines = [
    "[yard] ************************************************************************************",
    "[yard] Demo seeding is off (YARD_SEED_DEMO) and the server catalogue is empty.",
    "[yard] Categories and the holiday calendar were seeded; no sample brands, products or admins.",
    "[yard] The public shop shows only server data, so it shows empty states until brands list",
    "[yard] products. Create the first owner admin: npm run admin:create (README).",
    "[yard] ************************************************************************************",
  ]
  log.warn(lines.join("\n"))
}

/** POST /api/dev/reseed: re-runs one module now, ignoring its recorded version (§1.5). */
export async function reseedModule(key: string) {
  const m = seedModules.find((x) => x.key === key || x.key === `seed:${key}`)
  if (!m) return { ok: false as const, reason: "unknown" as const }
  if (m.version <= 0) return { ok: false as const, reason: "stub" as const, key: m.key }
  const started = Date.now()
  return withTx(async () => {
    const missing = await missingRequirement(m)
    if (missing) return { ok: false as const, reason: "waiting" as const, key: m.key, missing }
    await m.run(await context())
    await record(m)
    return { ok: true as const, key: m.key, version: m.version, ms: Date.now() - started }
  })
}

/** For GET /api/dev/selftest and db-check: the order, each module's version and what's recorded. */
export async function seedStatus() {
  const versions = await recordedVersions()
  const demo = new Set(demoModules)
  return seedModules.map((m) => ({ key: m.key, version: m.version, recorded: versions[m.key] ?? null, requires: m.requires ?? [], demo: demo.has(m) }))
}
