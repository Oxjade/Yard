import "server-only"
import { and, eq, getTableColumns, gte, inArray } from "drizzle-orm"
import type { PgTable } from "drizzle-orm/pg-core"
import { z } from "zod"
import type { AdminActor } from "../auth/dal"
import { db, withTx, afterCommit } from "../db"
import { auditLog, shippingClosures, shippingMethods, shippingProfiles, shippingRates, shippingZones } from "../db/schema"
import { forbidden, notFound } from "../http/errors"
import { invalidateShippingCache } from "../shipping/profile"

/**
 * Development only: an exact snapshot and restore of ONE brand's shipping (profile, zones,
 * methods, rates, closures), for N's kit check that saves Lagos Static's shipping to tick the
 * Studio setup card (§9.0 "restore only the shared fixture you touched"). Restoring puts every
 * row back as it was, ids and timestamps included, and deletes only the `shipping.profile_updated`
 * audit rows this run wrote: that brand, that actor, at or after the snapshot. Other brands, their
 * saves and their audit history are never touched (unlike reseeding the whole shipping module).
 */

type Row = Record<string, unknown>
export type ShippingSnapshot = { at: string; brandId: string; profile: Row | null; zones: Row[]; methods: Row[]; rates: Row[]; closures: Row[] }

const rowList = z.array(z.record(z.string(), z.unknown())).max(500)
export const shippingSnapshot = z.strictObject({
  at: z.iso.datetime({ offset: true }),
  brandId: z.string().regex(/^b_[a-z0-9_]{1,60}$/),
  profile: z.record(z.string(), z.unknown()).nullable(),
  zones: rowList,
  methods: rowList,
  rates: rowList,
  closures: rowList,
})
export const restoreBody = z.strictObject({
  snapshot: shippingSnapshot,
  /** The brand member whose kit save is being undone (its audit rows go); a seeded brand account. */
  actorId: z.string().regex(/^u_b_[a-z0-9_]{1,40}$/),
})

/** Only the owner and engineering admins may change test data (still development only). */
function assertCanRestore(actor: AdminActor) {
  if (actor.role !== "owner" && actor.role !== "engineering") throw forbidden("Only the owner or an engineering admin can restore test data.")
}

export async function snapshotShipping(actor: AdminActor, brandId: string): Promise<ShippingSnapshot> {
  assertCanRestore(actor)
  const d = await db()
  const [profile] = await d.select().from(shippingProfiles).where(eq(shippingProfiles.brandId, brandId)).limit(1)
  if (!profile) throw notFound("That brand has no shipping profile.")
  const zones = await d.select().from(shippingZones).where(eq(shippingZones.brandId, brandId))
  const methods = await d.select().from(shippingMethods).where(eq(shippingMethods.brandId, brandId))
  const rates = methods.length
    ? await d
        .select()
        .from(shippingRates)
        .where(
          inArray(
            shippingRates.methodId,
            methods.map((m) => m.id),
          ),
        )
    : []
  const closures = await d.select().from(shippingClosures).where(eq(shippingClosures.brandId, brandId))
  return JSON.parse(JSON.stringify({ at: new Date().toISOString(), brandId, profile, zones, methods, rates, closures })) as ShippingSnapshot
}

/** JSON rows back into insertable values: timestamp columns become Dates again; unknown keys are refused. */
function revive<T extends PgTable>(table: T, rows: Row[]): T["$inferInsert"][] {
  const cols = getTableColumns(table) as Record<string, { dataType: string }>
  return rows.map((r) => {
    const out: Row = {}
    for (const [k, v] of Object.entries(r)) {
      const col = cols[k]
      if (!col) throw new Error(`Snapshot field ${k} isn't a column of this table.`)
      out[k] = col.dataType === "date" && typeof v === "string" ? new Date(v) : v
    }
    return out as T["$inferInsert"]
  })
}

export async function restoreShipping(actor: AdminActor, body: z.infer<typeof restoreBody>) {
  assertCanRestore(actor)
  const s = body.snapshot
  const brandId = s.brandId
  const owned = (rows: Row[]) => rows.every((r) => r.brandId === undefined || r.brandId === brandId)
  if (!s.profile || s.profile.brandId !== brandId || !owned(s.zones) || !owned(s.methods) || !owned(s.closures)) throw notFound("That snapshot doesn't belong to one brand.")
  const methodIds = new Set(s.methods.map((m) => m.id))
  if (!s.rates.every((r) => methodIds.has(r.methodId))) throw notFound("That snapshot's rates don't belong to its methods.")

  return withTx(async () => {
    const d = await db()
    const methods = await d.select({ id: shippingMethods.id }).from(shippingMethods).where(eq(shippingMethods.brandId, brandId))
    if (methods.length)
      await d.delete(shippingRates).where(
        inArray(
          shippingRates.methodId,
          methods.map((m) => m.id),
        ),
      )
    await d.delete(shippingMethods).where(eq(shippingMethods.brandId, brandId))
    await d.delete(shippingZones).where(eq(shippingZones.brandId, brandId))
    await d.delete(shippingClosures).where(eq(shippingClosures.brandId, brandId))

    const [profile] = revive(shippingProfiles, [s.profile!])
    await d.update(shippingProfiles).set(profile).where(eq(shippingProfiles.brandId, brandId))
    if (s.zones.length) await d.insert(shippingZones).values(revive(shippingZones, s.zones))
    if (s.methods.length) await d.insert(shippingMethods).values(revive(shippingMethods, s.methods))
    if (s.rates.length) await d.insert(shippingRates).values(revive(shippingRates, s.rates))
    if (s.closures.length) await d.insert(shippingClosures).values(revive(shippingClosures, s.closures))

    const audit = await d
      .delete(auditLog)
      .where(
        and(
          eq(auditLog.action, "shipping.profile_updated"),
          eq(auditLog.subjectType, "shipping_profile"),
          eq(auditLog.subjectId, brandId),
          eq(auditLog.actorId, body.actorId),
          gte(auditLog.at, new Date(s.at)),
        ),
      )
      .returning({ id: auditLog.id })
    afterCommit(() => invalidateShippingCache(brandId))
    return { brandId, zones: s.zones.length, methods: s.methods.length, rates: s.rates.length, closures: s.closures.length, auditRows: audit.length }
  })
}
