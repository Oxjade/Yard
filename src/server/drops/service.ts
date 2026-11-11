import "server-only"
import { and, asc, count, desc, eq, gt, inArray, lte, ne, notInArray, or, sql, type SQL } from "drizzle-orm"
import { drops as sampleDrops } from "@/lib/data/catalog"
import { productById } from "@/lib/data/products"
import { writeAudit } from "../audit"
import type { BrandActor, ShopperActor } from "../auth/dal"
import { db, withTx } from "../db"
import { brandMembers, brands, shopperFollows, shopperReminders } from "../db/schema"
import { dropClaims, dropEntries, dropItems, drops } from "../db/schema/engagement"
import { signalActorFor, type RequestMeta } from "../follows"
import { badRequest, conflict, forbidden, notFound, rule } from "../http/errors"
import { newId } from "../ids"
import { indexedProducts } from "../search"
import { sellableVariants } from "../search/catalog-port"
import { ingestSignal } from "../signals"
import { refreshVisibility } from "../media/visibility"
import type { DropCreateBody, DropUpdateBody } from "./contracts"
import { DRAW_ALGORITHM, newDrawSeed, runDraw, winnersFor } from "./draw"
import { accessFor, claimedUnits } from "./limits"

/** Drops service (ENGAGEMENT v3): brand management, public reads, draw entries and reminders. */

export type DropRow = typeof drops.$inferSelect
export type DropPhase = "draft" | "upcoming" | "entries_open" | "early_access" | "live" | "ended" | "cancelled"

const HOUR = 3_600_000
const MAX_DURATION_MS = 30 * 24 * HOUR
const dropImageMediaId = (image: string | null | undefined) => image && !image.startsWith("/media/") ? image : null

export function phaseOf(d: DropRow, now = new Date()): DropPhase {
  if (d.status === "cancelled") return "cancelled"
  if (d.status === "draft") return "draft"
  if (d.status === "ended" || now >= d.endsAt) return "ended"
  if (now >= d.startsAt) return "live"
  if (d.access === "early_access" && d.earlyAccessAt && now >= d.earlyAccessAt) return "early_access"
  if (d.access === "draw" && !d.drawnAt && (!d.entryOpensAt || now >= d.entryOpensAt) && now < (d.entryClosesAt ?? d.startsAt)) return "entries_open"
  return "upcoming"
}

type BrandInfo = { id: string; handle: string; name: string }

async function brandInfo(ids: string[]): Promise<Map<string, BrandInfo>> {
  if (!ids.length) return new Map()
  const d = await db()
  const rows = await d.select({ id: brands.id, handle: brands.handle, name: brands.name }).from(brands).where(inArray(brands.id, [...new Set(ids)]))
  return new Map(rows.map((r) => [r.id, r]))
}

async function itemsOf(dropIds: string[]) {
  if (!dropIds.length) return new Map<string, { productIds: string[]; variantIds: string[] }>()
  const d = await db()
  const rows = await d.select().from(dropItems).where(inArray(dropItems.dropId, dropIds))
  const out = new Map<string, { productIds: string[]; variantIds: string[] }>()
  for (const r of rows) {
    const e = out.get(r.dropId) ?? { productIds: [], variantIds: [] }
    if (!e.productIds.includes(r.productId)) e.productIds.push(r.productId)
    e.variantIds.push(r.variantId)
    out.set(r.dropId, e)
  }
  return out
}

async function entryCounts(dropIds: string[]) {
  if (!dropIds.length) return new Map<string, number>()
  const d = await db()
  const rows = await d.select({ id: dropEntries.dropId, n: count() }).from(dropEntries).where(and(inArray(dropEntries.dropId, dropIds), ne(dropEntries.status, "withdrawn"))).groupBy(dropEntries.dropId)
  return new Map(rows.map((r) => [r.id, r.n]))
}

const iso = (d: Date | null) => (d ? d.toISOString() : null)

export function toDropDto(row: DropRow, brand: BrandInfo | undefined, items: { productIds: string[]; variantIds: string[] } | undefined, entries: number | undefined, now = new Date()) {
  return {
    id: row.id,
    slug: row.slug,
    brand: brand ? { id: brand.id, handle: brand.handle, name: brand.name } : { id: row.brandId, handle: null, name: null },
    name: row.name,
    description: row.description,
    image: row.image,
    access: row.access,
    status: row.status,
    phase: phaseOf(row, now),
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    earlyAccessAt: iso(row.earlyAccessAt),
    entryOpensAt: iso(row.entryOpensAt),
    entryClosesAt: row.access === "draw" ? iso(row.entryClosesAt ?? row.startsAt) : null,
    drawnAt: iso(row.drawnAt),
    purchaseWindowMinutes: row.purchaseWindowMinutes,
    winners: row.access === "draw" ? winnersFor(row) : null,
    limitPerCustomer: row.limitPerCustomer,
    totalUnits: row.totalUnits,
    productIds: items?.productIds ?? [],
    entries: row.access === "draw" ? (entries ?? 0) : null,
    sponsored: row.sponsored,
    version: row.version,
  }
}

async function dtos(rows: DropRow[]) {
  const ids = rows.map((r) => r.id)
  const [b, items, entries] = await Promise.all([brandInfo(rows.map((r) => r.brandId)), itemsOf(ids), entryCounts(ids)])
  const now = new Date()
  return rows.map((r) => toDropDto(r, b.get(r.brandId), items.get(r.id), entries.get(r.id), now))
}

/* ---------- Public reads ---------- */

export async function listPublicDrops(q: { phase?: "upcoming" | "live" | "ended" | "all"; brandId?: string; limit?: number; cursor?: string }) {
  const d = await db()
  const now = new Date()
  const limit = q.limit ?? 24
  const offset = q.cursor ? Number(q.cursor) : 0
  const conds: (SQL | undefined)[] = [notInArray(drops.status, ["draft", "cancelled"]), q.brandId ? eq(drops.brandId, q.brandId) : undefined]
  const notSuspended = sql`${drops.brandId} not in (select id from brands where review_status = 'suspended')`
  conds.push(notSuspended)
  let order = [asc(drops.startsAt)]
  if (q.phase === "upcoming") conds.push(gt(drops.startsAt, now), ne(drops.status, "ended"))
  else if (q.phase === "live") conds.push(lte(drops.startsAt, now), gt(drops.endsAt, now), ne(drops.status, "ended"))
  else if (q.phase === "ended") {
    conds.push(or(eq(drops.status, "ended"), lte(drops.endsAt, now)))
    order = [desc(drops.endsAt)]
  }
  const rows = await d
    .select()
    .from(drops)
    .where(and(...conds))
    .orderBy(...order, asc(drops.id))
    .limit(limit + 1)
    .offset(offset)
  const page = rows.slice(0, limit)
  return { items: await dtos(page), nextCursor: rows.length > limit ? String(offset + limit) : null }
}

/** A drop by id or slug. Drafts and cancelled drops only for members of its brand (`brandId`). */
export async function loadDrop(idOrSlug: string, opts: { brandId?: string } = {}): Promise<DropRow | null> {
  const d = await db()
  const [row] = await d
    .select()
    .from(drops)
    .where(or(eq(drops.id, idOrSlug), eq(drops.slug, idOrSlug)))
    .limit(1)
  if (!row) return null
  if (opts.brandId) return row.brandId === opts.brandId ? row : null
  if (row.status === "draft") return null
  const [b] = await d.select({ s: brands.reviewStatus }).from(brands).where(eq(brands.id, row.brandId)).limit(1)
  if (b?.s === "suspended") return null
  return row
}

/** Live availability across the drop's variants (CATALOG), or null when CATALOG isn't loaded. */
async function unitsAvailable(variantIds: string[]) {
  const live = await sellableVariants(variantIds).catch(() => [])
  if (!live.length) return null
  return live.reduce((n, v) => n + Math.max(0, v.available), 0)
}

/** The public drop with the viewer's own state (reminder, entry, whether they can buy now). */
export async function dropDetail(row: DropRow, viewer: ShopperActor | null) {
  const [dto] = await dtos([row])
  const items = (await itemsOf([row.id])).get(row.id)
  const available = await unitsAvailable(items?.variantIds ?? [])
  let me = null
  if (viewer) {
    const d = await db()
    const [rem, entry, follow] = await Promise.all([
      d.select({ u: shopperReminders.userId }).from(shopperReminders).where(and(eq(shopperReminders.userId, viewer.userId), eq(shopperReminders.dropId, row.id))).limit(1),
      d.select().from(dropEntries).where(and(eq(dropEntries.dropId, row.id), eq(dropEntries.userId, viewer.userId))).limit(1),
      d.select({ at: shopperFollows.createdAt }).from(shopperFollows).where(and(eq(shopperFollows.userId, viewer.userId), eq(shopperFollows.brandId, row.brandId))).limit(1),
    ])
    const access = row.status === "draft" ? { ok: false as const, message: "Not published." } : await accessFor(d, row, viewer.userId)
    const claimed = await claimedUnits(d, row.id, viewer.userId)
    const e = entry[0]
    me = {
      reminder: rem.length > 0,
      following: follow.length > 0,
      earlyAccess: row.access === "early_access" && !!follow[0] && !!row.earlyAccessAt && follow[0].at < row.earlyAccessAt,
      entry: e ? { status: e.status, rank: e.rank, windowOpensAt: iso(e.windowOpensAt), windowEndsAt: iso(e.windowEndsAt), enteredAt: e.createdAt.toISOString() } : null,
      canBuy: access.ok && claimed < row.limitPerCustomer,
      reason: access.ok ? (claimed >= row.limitPerCustomer ? `You've reached the limit of ${row.limitPerCustomer}.` : null) : access.message,
      claimed,
      remainingAllowance: Math.max(0, row.limitPerCustomer - claimed),
    }
  }
  return { drop: { ...dto, variantIds: items?.variantIds ?? [], unitsAvailable: available }, me }
}

/** Public draw transparency: the committed hash, the seed once drawn, the method and counts. */
export async function drawInfo(row: DropRow, viewerId: string | null) {
  if (row.access !== "draw") throw notFound("This drop isn't a draw.")
  const d = await db()
  const rows = await d.select({ status: dropEntries.status, n: count() }).from(dropEntries).where(eq(dropEntries.dropId, row.id)).groupBy(dropEntries.status)
  const by = Object.fromEntries(rows.map((r) => [r.status, r.n]))
  const [mine] = viewerId ? await d.select().from(dropEntries).where(and(eq(dropEntries.dropId, row.id), eq(dropEntries.userId, viewerId))).limit(1) : []
  return {
    dropId: row.id,
    algorithm: DRAW_ALGORITHM,
    seedHash: row.drawSeedHash,
    seed: row.drawnAt ? row.drawSeed : null,
    drawnAt: iso(row.drawnAt),
    entryClosesAt: (row.entryClosesAt ?? row.startsAt).toISOString(),
    winners: winnersFor(row),
    counts: { entries: Object.entries(by).filter(([s]) => s !== "withdrawn").reduce((n, [, c]) => n + c, 0), won: (by.won ?? 0) + (by.purchased ?? 0) + (by.expired ?? 0), purchased: by.purchased ?? 0, waitlisted: by.waitlisted ?? 0 },
    me: mine ? { status: mine.status, rank: mine.rank, windowOpensAt: iso(mine.windowOpensAt), windowEndsAt: iso(mine.windowEndsAt) } : null,
  }
}

/** The shopper's draw entries and reminders. */
export async function myDrops(userId: string) {
  const d = await db()
  const [entries, reminders] = await Promise.all([
    d.select({ entry: dropEntries, drop: drops }).from(dropEntries).innerJoin(drops, eq(drops.id, dropEntries.dropId)).where(eq(dropEntries.userId, userId)).orderBy(desc(dropEntries.createdAt)).limit(100),
    d.select({ dropId: shopperReminders.dropId, at: shopperReminders.createdAt }).from(shopperReminders).where(eq(shopperReminders.userId, userId)).orderBy(desc(shopperReminders.createdAt)).limit(200),
  ])
  const remDrops = reminders.length ? await d.select().from(drops).where(inArray(drops.id, reminders.map((r) => r.dropId))) : []
  const all = [...new Map([...entries.map((e) => e.drop), ...remDrops].filter((r) => r.status !== "draft").map((r) => [r.id, r])).values()]
  const dto = new Map((await dtos(all)).map((x) => [x.id, x]))
  return {
    entries: entries.filter((e) => dto.has(e.drop.id)).map((e) => ({ drop: dto.get(e.drop.id)!, status: e.entry.status, rank: e.entry.rank, windowOpensAt: iso(e.entry.windowOpensAt), windowEndsAt: iso(e.entry.windowEndsAt), enteredAt: e.entry.createdAt.toISOString() })),
    reminders: reminders.map((r) => ({ dropId: r.dropId, setAt: r.at.toISOString(), drop: dto.get(r.dropId) ?? null })),
  }
}

/* ---------- Shopper actions ---------- */

async function assertNotMember(userId: string, brandId: string) {
  const d = await db()
  const [m] = await d.select({ id: brandMembers.id }).from(brandMembers).where(and(eq(brandMembers.userId, userId), eq(brandMembers.brandId, brandId), eq(brandMembers.status, "active"))).limit(1)
  if (m) throw forbidden("Members of a brand can't enter its own draws.")
}

export async function enterDraw(shopper: ShopperActor, row: DropRow) {
  if (row.access !== "draw") throw rule("This drop isn't a draw.")
  if (phaseOf(row) !== "entries_open") throw rule(row.drawnAt ? "The draw has already happened." : "Entries aren't open for this drop.")
  if (shopper.status === "suspended") throw forbidden()
  await assertNotMember(shopper.userId, row.brandId)
  return withTx(async (tx) => {
    const [existing] = await tx.select().from(dropEntries).where(and(eq(dropEntries.dropId, row.id), eq(dropEntries.userId, shopper.userId))).limit(1)
    if (existing && existing.status !== "withdrawn") return { entered: true, status: existing.status, enteredAt: existing.createdAt.toISOString() }
    if (existing) {
      await tx.update(dropEntries).set({ status: "entered", createdAt: new Date(), decidedAt: null, rank: null }).where(eq(dropEntries.id, existing.id))
      return { entered: true, status: "entered", enteredAt: new Date().toISOString() }
    }
    const [e] = await tx.insert(dropEntries).values({ id: newId("den"), dropId: row.id, userId: shopper.userId, status: "entered" }).returning()
    return { entered: true, status: e.status, enteredAt: e.createdAt.toISOString() }
  })
}

export async function withdrawEntry(shopper: ShopperActor, row: DropRow) {
  if (row.drawnAt) throw rule("The draw has already happened.")
  await withTx(async (tx) => {
    await tx
      .update(dropEntries)
      .set({ status: "withdrawn", decidedAt: new Date() })
      .where(and(eq(dropEntries.dropId, row.id), eq(dropEntries.userId, shopper.userId), eq(dropEntries.status, "entered")))
  })
  return { entered: false }
}

const isSampleDrop = (id: string) => sampleDrops.some((d) => d.id === id)

/** Drop reminders keep using shopper_reminders and signals ingest (sample drops), so charts keep counting them. */
export async function setReminder(shopper: ShopperActor, row: DropRow, on: boolean, meta: RequestMeta) {
  if (on && phaseOf(row) === "ended") throw rule("This drop has ended.")
  if (on && row.status === "cancelled") throw rule("This drop was cancelled.")
  if (isSampleDrop(row.id)) await ingestSignal({ kind: on ? "reminder_set" : "reminder_unset", dropId: row.id }, signalActorFor(shopper, meta))
  else
    await withTx(async (tx) => {
      if (on) await tx.insert(shopperReminders).values({ userId: shopper.userId, dropId: row.id, brandId: row.brandId }).onConflictDoNothing()
      else await tx.delete(shopperReminders).where(and(eq(shopperReminders.userId, shopper.userId), eq(shopperReminders.dropId, row.id)))
    })
  return { dropId: row.id, reminder: on }
}

/* ---------- Brand management ---------- */

const slugify = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "drop"

async function uniqueSlug(base: string, exceptId?: string) {
  const d = await db()
  for (let i = 0; i < 50; i++) {
    const s = i ? `${base}-${i + 1}` : base
    const [hit] = await d.select({ id: drops.id }).from(drops).where(eq(drops.slug, s)).limit(1)
    if (!hit || hit.id === exceptId) return s
  }
  return `${base}-${Date.now().toString(36)}`
}

/** The brand's products and their variants (sample catalogue or search index; CATALOG's live variants when loaded). */
async function resolveItems(brandId: string, productIds: string[], variantIds: string[] | null | undefined) {
  const indexed = new Map((await indexedProducts(productIds)).map((r) => [r.productId, r]))
  const fields: Record<string, string> = {}
  const pairs: { productId: string; variantId: string }[] = []
  productIds.forEach((pid, i) => {
    const ix = indexed.get(pid)
    const sample = productById.get(pid)
    const owner = ix?.brandId ?? sample?.brandId
    if (!owner || owner !== brandId) {
      fields[`productIds.${i}`] = "Choose one of your own products."
      return
    }
    const vids = ix?.variantIds.length ? ix.variantIds : (sample?.variants.map((v) => v.id) ?? [])
    for (const v of vids) pairs.push({ productId: pid, variantId: v })
  })
  if (Object.keys(fields).length) throw badRequest(fields)
  const live = await sellableVariants(pairs.map((p) => p.variantId)).catch(() => [])
  if (live.length) {
    const foreign = live.find((v) => v.brandId !== brandId)
    if (foreign) throw badRequest({ productIds: "Choose only your own products." })
  }
  let chosen = pairs
  if (variantIds?.length) {
    const known = new Set(pairs.map((p) => p.variantId))
    const bad = variantIds.findIndex((v) => !known.has(v))
    if (bad >= 0) throw badRequest({ [`variantIds.${bad}`]: "This variant isn't one of the chosen products." })
    const want = new Set(variantIds)
    chosen = pairs.filter((p) => want.has(p.variantId))
  }
  if (!chosen.length) throw badRequest({ productIds: "These products have no variants to sell." })
  return chosen
}

type Times = Pick<DropRow, "access" | "startsAt" | "endsAt" | "earlyAccessAt" | "entryOpensAt" | "entryClosesAt">

/** Normalises defaults and checks the time rules; `forSchedule` also requires the future. */
function checkTimes(t: Times, forSchedule: boolean, now = new Date()): Times {
  // Only the time fields: callers spread the result into an update, and scheduleDrop passes the whole row.
  const out: Times = { access: t.access, startsAt: t.startsAt, endsAt: t.endsAt, earlyAccessAt: t.earlyAccessAt, entryOpensAt: t.entryOpensAt, entryClosesAt: t.entryClosesAt }
  const f: Record<string, string> = {}
  if (out.endsAt <= out.startsAt) f.endsAt = "End the drop after it starts."
  else if (out.endsAt.getTime() - out.startsAt.getTime() > MAX_DURATION_MS) f.endsAt = "A drop can run for 30 days at most."
  if (out.access === "early_access") {
    out.earlyAccessAt ??= new Date(out.startsAt.getTime() - 24 * HOUR)
    if (out.earlyAccessAt >= out.startsAt) f.earlyAccessAt = "Early access must start before the public release."
    else if (out.startsAt.getTime() - out.earlyAccessAt.getTime() > 7 * 24 * HOUR) f.earlyAccessAt = "Early access can open at most 7 days before release."
  } else out.earlyAccessAt = null
  if (out.access === "draw") {
    out.entryClosesAt ??= out.startsAt
    if (out.entryClosesAt > out.startsAt) f.entryClosesAt = "Close entries at or before the release."
    if (out.entryOpensAt && out.entryOpensAt >= out.entryClosesAt) f.entryOpensAt = "Open entries before they close."
  } else {
    out.entryOpensAt = null
    out.entryClosesAt = null
  }
  if (forSchedule) {
    const soon = new Date(now.getTime() + 60_000)
    if (out.startsAt < soon) f.startsAt = "Choose a release time in the future."
    if (out.access === "draw" && out.entryClosesAt && out.entryClosesAt < soon) f.entryClosesAt = "Choose a time in the future for entries to close."
    if (out.access === "early_access" && out.earlyAccessAt && out.earlyAccessAt < now) f.earlyAccessAt = "Choose a time in the future for early access."
  }
  if (Object.keys(f).length) throw badRequest(f)
  return out
}

/** A variant can be in only one scheduled or live drop whose window overlaps. */
async function assertNoOverlap(dropId: string | null, variantIds: string[], t: Times) {
  const d = await db()
  const [hit] = await d
    .select({ id: drops.id, name: drops.name })
    .from(dropItems)
    .innerJoin(drops, eq(drops.id, dropItems.dropId))
    .where(
      and(
        inArray(dropItems.variantId, variantIds),
        inArray(drops.status, ["scheduled", "live"]),
        dropId ? ne(drops.id, dropId) : undefined,
        sql`${drops.startsAt} < ${t.endsAt}`,
        sql`${drops.endsAt} > ${t.earlyAccessAt ?? t.entryOpensAt ?? t.startsAt}`,
      ),
    )
    .limit(1)
  if (hit) throw conflict(`Some of these pieces are already in ${hit.name} at the same time.`)
}

const toDate = (s: string | null | undefined) => (s ? new Date(s) : null)

const auditActor = (a: BrandActor) => ({ kind: "brand" as const, id: a.userId, name: a.name, role: a.role })

export async function createDrop(actor: BrandActor, body: DropCreateBody, ipHash: string | null) {
  const pairs = await resolveItems(actor.brandId, body.productIds, body.variantIds)
  const times = checkTimes(
    { access: body.access, startsAt: new Date(body.startsAt), endsAt: new Date(body.endsAt), earlyAccessAt: toDate(body.earlyAccessAt), entryOpensAt: toDate(body.entryOpensAt), entryClosesAt: toDate(body.entryClosesAt) },
    false,
  )
  if (body.access === "draw" && body.totalUnits < 1 && !body.winnersCount) throw badRequest({ totalUnits: "Set the units (or the number of winners) for a draw." })
  const created = await withTx(async (tx) => {
    const slug = await uniqueSlug(body.slug ?? slugify(body.name))
    const id = newId("drp")
    const [row] = await tx
      .insert(drops)
      .values({
        id,
        brandId: actor.brandId,
        slug,
        name: body.name,
        description: body.description,
        image: body.image ?? null,
        status: "draft",
        ...times,
        purchaseWindowMinutes: body.purchaseWindowMinutes,
        winnersCount: body.winnersCount ?? null,
        limitPerCustomer: body.limitPerCustomer,
        totalUnits: body.totalUnits,
        reminderLeadMinutes: body.reminderLeadMinutes,
        createdBy: actor.userId,
      })
      .returning()
    await tx.insert(dropItems).values(pairs.map((p) => ({ dropId: id, ...p })))
    await writeAudit({ actor: auditActor(actor), action: "drop.create", target: row.name, subjectType: "drop", subjectId: id, brandId: actor.brandId, ipHash, meta: { access: row.access, startsAt: row.startsAt.toISOString(), products: body.productIds.length } })
    return (await dtos([row]))[0]
  })
  await refreshVisibility([dropImageMediaId(body.image)].filter((id): id is string => !!id))
  return created
}

function assertVersion(row: DropRow, expected: number) {
  if (row.version !== expected) throw conflict("Someone else changed this drop. Reload it and try again.")
}

export async function updateDrop(actor: BrandActor, row: DropRow, body: DropUpdateBody, ipHash: string | null) {
  assertVersion(row, body.expectedVersion)
  const now = new Date()
  if (row.status !== "draft" && row.status !== "scheduled") throw rule("Only draft or scheduled drops can be edited.")
  if (row.status === "scheduled" && now >= (row.earlyAccessAt ?? row.startsAt)) throw rule("This drop has started; it can't be edited. Cancel it instead.")
  if (row.drawnAt && (body.startsAt || body.entryClosesAt !== undefined || body.access || body.winnersCount !== undefined)) throw rule("The draw has happened; its times and winners can't change.")
  if (row.status === "scheduled" && body.access && body.access !== row.access) throw rule("Move the drop back to draft to change how shoppers get access.")
  const access = body.access ?? row.access
  const times = checkTimes(
    {
      access,
      startsAt: body.startsAt ? new Date(body.startsAt) : row.startsAt,
      endsAt: body.endsAt ? new Date(body.endsAt) : row.endsAt,
      earlyAccessAt: body.earlyAccessAt !== undefined ? toDate(body.earlyAccessAt) : row.earlyAccessAt,
      entryOpensAt: body.entryOpensAt !== undefined ? toDate(body.entryOpensAt) : row.entryOpensAt,
      entryClosesAt: body.entryClosesAt !== undefined ? toDate(body.entryClosesAt) : row.entryClosesAt,
    },
    row.status === "scheduled",
  )
  const pairs = body.productIds || body.variantIds ? await resolveItems(actor.brandId, body.productIds ?? (await itemsOf([row.id])).get(row.id)?.productIds ?? [], body.variantIds) : null
  if (row.status === "scheduled") await assertNoOverlap(row.id, pairs?.map((p) => p.variantId) ?? (await itemsOf([row.id])).get(row.id)?.variantIds ?? [], times)
  const timesChanged = times.startsAt.getTime() !== row.startsAt.getTime() || (times.entryClosesAt?.getTime() ?? 0) !== (row.entryClosesAt?.getTime() ?? 0)
  const updated = await withTx(async (tx) => {
    const slug = body.slug && body.slug !== row.slug ? await uniqueSlug(body.slug, row.id) : row.slug
    const [next] = await tx
      .update(drops)
      .set({
        slug,
        name: body.name ?? row.name,
        description: body.description ?? row.description,
        image: body.image !== undefined ? body.image : row.image,
        ...times,
        purchaseWindowMinutes: body.purchaseWindowMinutes ?? row.purchaseWindowMinutes,
        winnersCount: body.winnersCount !== undefined ? body.winnersCount : row.winnersCount,
        limitPerCustomer: body.limitPerCustomer ?? row.limitPerCustomer,
        totalUnits: body.totalUnits ?? row.totalUnits,
        reminderLeadMinutes: body.reminderLeadMinutes ?? row.reminderLeadMinutes,
        reminderSentAt: timesChanged ? null : row.reminderSentAt,
        earlyAccessSentAt: timesChanged ? null : row.earlyAccessSentAt,
        drawSeed: access === "draw" ? row.drawSeed : null,
        drawSeedHash: access === "draw" ? row.drawSeedHash : null,
        version: row.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(drops.id, row.id), eq(drops.version, row.version)))
      .returning()
    if (!next) throw conflict("Someone else changed this drop. Reload it and try again.")
    if (pairs) {
      await tx.delete(dropItems).where(eq(dropItems.dropId, row.id))
      await tx.insert(dropItems).values(pairs.map((p) => ({ dropId: row.id, ...p })))
    }
    await writeAudit({ actor: auditActor(actor), action: "drop.update", target: next.name, subjectType: "drop", subjectId: row.id, brandId: actor.brandId, ipHash, meta: { fields: Object.keys(body).filter((k) => k !== "expectedVersion") } })
    return (await dtos([next]))[0]
  })
  await refreshVisibility([row.image, body.image].map(dropImageMediaId).filter((id): id is string => !!id))
  return updated
}

export async function scheduleDrop(actor: BrandActor, row: DropRow, expectedVersion: number, ipHash: string | null) {
  assertVersion(row, expectedVersion)
  if (row.status !== "draft") throw rule("Only a draft can be scheduled.")
  const times = checkTimes(row, true)
  const items = (await itemsOf([row.id])).get(row.id)
  if (!items?.variantIds.length) throw rule("Add products before scheduling.")
  await assertNoOverlap(row.id, items.variantIds, times)
  const scheduled = await withTx(async (tx) => {
    const seed = row.access === "draw" ? newDrawSeed() : null
    const [next] = await tx
      .update(drops)
      .set({ status: "scheduled", ...times, drawSeed: seed?.seed ?? null, drawSeedHash: seed?.hash ?? null, version: row.version + 1, updatedAt: new Date() })
      .where(and(eq(drops.id, row.id), eq(drops.version, row.version)))
      .returning()
    if (!next) throw conflict("Someone else changed this drop. Reload it and try again.")
    await writeAudit({ actor: auditActor(actor), action: "drop.schedule", target: next.name, subjectType: "drop", subjectId: row.id, brandId: actor.brandId, ipHash, meta: { startsAt: next.startsAt.toISOString(), access: next.access, seedHash: next.drawSeedHash } })
    return (await dtos([next]))[0]
  })
  await refreshVisibility([dropImageMediaId(row.image)].filter((id): id is string => !!id))
  return scheduled
}

/** Back to draft before anything has started (no entries yet). */
export async function unscheduleDrop(actor: BrandActor, row: DropRow, expectedVersion: number, ipHash: string | null) {
  assertVersion(row, expectedVersion)
  if (row.status !== "scheduled") throw rule("Only a scheduled drop can go back to draft.")
  if (new Date() >= (row.earlyAccessAt ?? row.startsAt)) throw rule("This drop has started.")
  const d = await db()
  const [e] = await d.select({ n: count() }).from(dropEntries).where(eq(dropEntries.dropId, row.id))
  if ((e?.n ?? 0) > 0) throw rule("Shoppers have entered this draw; cancel it instead.")
  const unscheduled = await withTx(async (tx) => {
    const [next] = await tx
      .update(drops)
      .set({ status: "draft", drawSeed: null, drawSeedHash: null, reminderSentAt: null, earlyAccessSentAt: null, version: row.version + 1, updatedAt: new Date() })
      .where(and(eq(drops.id, row.id), eq(drops.version, row.version)))
      .returning()
    if (!next) throw conflict("Someone else changed this drop. Reload it and try again.")
    await writeAudit({ actor: auditActor(actor), action: "drop.unschedule", target: next.name, subjectType: "drop", subjectId: row.id, brandId: actor.brandId, ipHash })
    return (await dtos([next]))[0]
  })
  await refreshVisibility([dropImageMediaId(row.image)].filter((id): id is string => !!id))
  return unscheduled
}

export async function cancelDrop(actor: BrandActor, row: DropRow, expectedVersion: number, ipHash: string | null) {
  assertVersion(row, expectedVersion)
  if (row.status === "ended" || row.status === "cancelled") throw rule("This drop is already over.")
  const cancelled = await withTx(async (tx) => {
    const [next] = await tx
      .update(drops)
      .set({ status: "cancelled", endedAt: new Date(), version: row.version + 1, updatedAt: new Date() })
      .where(and(eq(drops.id, row.id), eq(drops.version, row.version)))
      .returning()
    if (!next) throw conflict("Someone else changed this drop. Reload it and try again.")
    await tx.update(dropClaims).set({ status: "released" }).where(and(eq(dropClaims.dropId, row.id), eq(dropClaims.status, "pending")))
    await tx
      .update(dropEntries)
      .set({ status: "lost", decidedAt: new Date() })
      .where(and(eq(dropEntries.dropId, row.id), inArray(dropEntries.status, ["entered", "won", "waitlisted"])))
    await writeAudit({ actor: auditActor(actor), action: "drop.cancel", target: next.name, subjectType: "drop", subjectId: row.id, brandId: actor.brandId, ipHash })
    return (await dtos([next]))[0]
  })
  await refreshVisibility([dropImageMediaId(row.image)].filter((id): id is string => !!id))
  return cancelled
}

/** Runs the draw now (only once entries have closed; the scheduler normally does this). */
export async function drawNow(actor: BrandActor, row: DropRow, ipHash: string | null) {
  if (row.access !== "draw") throw rule("This drop isn't a draw.")
  if (row.drawnAt) throw rule("The draw has already happened.")
  if (new Date() < (row.entryClosesAt ?? row.startsAt)) throw rule("Entries are still open.")
  const out = await runDraw(row.id)
  if (!out) throw rule("This draw can't run now.")
  const { announceDraw } = await import("./jobs")
  await announceDraw(out)
  await withTx(() => writeAudit({ actor: auditActor(actor), action: "drop.draw", target: row.name, subjectType: "drop", subjectId: row.id, brandId: actor.brandId, ipHash, meta: { entries: out.entries, winners: out.winners.length } }))
  return drawInfo((await loadDrop(row.id, { brandId: actor.brandId }))!, null)
}

/** Studio list: a page of brand drops with entry and reminder counts. */
export async function listBrandDrops(brandId: string, q: { status?: string; limit?: number; cursor?: string } = {}) {
  const d = await db()
  const limit = q.limit ?? 50
  const offset = q.cursor ? Number(q.cursor) : 0
  const rows = await d
    .select()
    .from(drops)
    .where(and(eq(drops.brandId, brandId), q.status && q.status !== "all" ? eq(drops.status, q.status) : undefined))
    .orderBy(desc(drops.startsAt), asc(drops.id))
    .limit(limit + 1)
    .offset(offset)
  const page = rows.slice(0, limit)
  const ids = page.map((r) => r.id)
  const reminders = ids.length ? await d.select({ id: shopperReminders.dropId, n: count() }).from(shopperReminders).where(inArray(shopperReminders.dropId, ids)).groupBy(shopperReminders.dropId) : []
  const remBy = new Map(reminders.map((r) => [r.id, r.n]))
  return {
    items: (await dtos(page)).map((x, i) => ({ ...x, variantIds: undefined, reminders: remBy.get(x.id) ?? 0, drawSeedHash: page[i].drawSeedHash })),
    nextCursor: rows.length > limit ? String(offset + limit) : null,
  }
}
