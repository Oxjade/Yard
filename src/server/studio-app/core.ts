import { and, asc, desc, eq, gte, inArray, ne, sql } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import { countries, type CountryCode } from "@/config/markets"
import { countryTimeZone, dateIn, shiftDate } from "@/lib/data/zones"
import { handleCandidates, slugifyHandle } from "@/lib/from-website"
import type { BrandMembershipDto, BrandMembershipStatus, SalesWindowDto, StudioApplicationDto, StudioApplyBody } from "@/lib/api/contracts/studio-app"
import { instagramHandleOf } from "@/lib/api/contracts/studio-app"
import { brandMembers, brands, mediaAssets, orderRefs, users } from "../db/schema/index"
import { brandOnboardings, catalogCategories, catalogProducts, catalogVariants, storefrontDrafts } from "../db/schema/catalog"
import { chartEvents } from "../db/schema/charts"
import { studioPushPreferences } from "../db/schema/engagement"
import { orderStates } from "../db/schema/orders-v3"

/**
 * Studio in the apps (docs/APP.md › Studio in the app): the database half, without "server-only",
 * so the tests run these exact statements on PGlite with the migrations (core.test.ts). The
 * request half (sessions, cookies, audit, the importer) is in index.ts.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any drizzle Postgres database or transaction (PGlite, node-postgres)
export type Db = PgDatabase<PgQueryResultHKT, any>

/* ---------- Memberships ---------- */

export function membershipStatus(b: { reviewStatus: string; founding: boolean; claimStatus: string }): BrandMembershipStatus {
  if (b.reviewStatus === "suspended") return "suspended"
  if (b.reviewStatus === "restricted") return "restricted"
  if (b.founding && b.claimStatus === "claimed") return "claimed"
  if (b.reviewStatus === "pending_review") return "pending_review"
  return "approved"
}

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?"

/**
 * The brands a person belongs to, as GET /api/session lists them for a shopper session: active
 * memberships only, never Yard's own setup access to a founding brand, oldest first (the brand a
 * plain brand sign-in opens on comes first).
 */
export async function membershipsOf(d: Db, userId: string): Promise<BrandMembershipDto[]> {
  const rows = await d
    .select({ id: brands.id, handle: brands.handle, name: brands.name, logo: brands.logoMediaId, logoVisibility: mediaAssets.visibility, logoModeration: mediaAssets.moderationStatus, role: brandMembers.role, reviewStatus: brands.reviewStatus, founding: brands.founding, claimStatus: brands.claimStatus })
    .from(brandMembers)
    .innerJoin(brands, eq(brands.id, brandMembers.brandId))
    .leftJoin(mediaAssets, eq(mediaAssets.id, brands.logoMediaId))
    .where(and(eq(brandMembers.userId, userId), eq(brandMembers.status, "active"), ne(brandMembers.role, "yard_setup")))
    .orderBy(asc(brandMembers.createdAt), asc(brandMembers.id))
  return rows.map((r) => {
    const status = membershipStatus(r)
    return {
      id: r.id,
      handle: r.handle,
      name: r.name,
      // A public logo loads without a cookie; a private one (a brand not live yet) only with the
      // brand session (?as=brand), so the app shows `initials` until it has switched.
      logoSrc: !r.logo || r.logoModeration === "removed" ? null : r.logoVisibility === "public" ? `/api/media/${encodeURIComponent(r.logo)}` : `/api/media/${encodeURIComponent(r.logo)}?as=brand`,
      initials: initialsOf(r.name),
      role: r.role as BrandMembershipDto["role"],
      status,
      canOpenStudio: status !== "suspended",
    }
  })
}

/**
 * Whether `userId` may open a brand session on `brandId` from their shopper session: an active
 * membership (not Yard setup) of a brand that isn't suspended. Anything else is refused, with a
 * reason the route turns into 403.
 */
export async function switchTarget(d: Db, userId: string, brandId: string): Promise<{ ok: true; brandId: string } | { ok: false; reason: "not_member" | "suspended" }> {
  const [m] = await d
    .select({ reviewStatus: brands.reviewStatus })
    .from(brandMembers)
    .innerJoin(brands, eq(brands.id, brandMembers.brandId))
    .where(and(eq(brandMembers.userId, userId), eq(brandMembers.brandId, brandId), eq(brandMembers.status, "active"), ne(brandMembers.role, "yard_setup")))
    .limit(1)
  if (!m) return { ok: false, reason: "not_member" }
  if (m.reviewStatus === "suspended") return { ok: false, reason: "suspended" }
  return { ok: true, brandId }
}

/* ---------- The short application ---------- */

type OnboardingRow = typeof brandOnboardings.$inferSelect

export async function latestApplication(d: Db, userId: string) {
  const [row] = await d.select().from(brandOnboardings).where(eq(brandOnboardings.userId, userId)).orderBy(desc(brandOnboardings.createdAt)).limit(1)
  return row ?? null
}

export async function applicationDto(d: Db, row: OnboardingRow): Promise<StudioApplicationDto> {
  const [b] = row.brandId ? await d.select({ id: brands.id, handle: brands.handle, name: brands.name }).from(brands).where(eq(brands.id, row.brandId)).limit(1) : []
  const short = (row.data as { short?: unknown }).short
  return {
    id: row.id,
    status: row.status as StudioApplicationDto["status"],
    source: short ? "app" : "studio",
    brand: b ?? null,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reviewNote: row.status === "rejected" ? row.reviewNote : null,
  }
}

export class ApplyRefused extends Error {
  constructor(
    readonly kind: "category" | "open_draft" | "approved" | "on_hold" | "handle",
    message: string,
  ) {
    super(message)
  }
}

export type ApplyDeps = {
  newId: (prefix: string) => string
  /** The onboarding wizard's own handle rules (reserved words, brands and open applications). */
  handleFree: (handle: string, exceptOnboardingId: string | null, exceptBrandId: string | null) => Promise<boolean>
  /** The storefront draft a new brand starts from (catalog/storefront.ts DEFAULT_STOREFRONT). */
  defaultStorefront: Record<string, unknown>
  now?: Date
}

/**
 * Writes the short application (call inside a transaction): a brand in `pending_review` with the
 * applicant as owner and a storefront draft, plus a `submitted` application, so it lands in
 * Admin › Brands like a website application (the reviewers see `data.short`). Idempotent while it
 * waits: a second call returns the submitted application unchanged. A rejected application is
 * resubmitted on the same brand (never lifting a suspension or restriction). A website draft that
 * hasn't been submitted is refused (409): finish or clear it first.
 */
export async function writeShortApplication(d: Db, user: { id: string; name: string; email: string }, body: StudioApplyBody, deps: ApplyDeps): Promise<{ row: OnboardingRow; created: boolean }> {
  const now = deps.now ?? new Date()
  const current = await latestApplication(d, user.id)
  if (current?.status === "submitted") return { row: current, created: false }
  if (current?.status === "approved") throw new ApplyRefused("approved", "Your shop is already approved. Open Studio to manage it.")
  if (current?.status === "draft") throw new ApplyRefused("open_draft", "You have an application in progress on the website. Finish it there, or clear it, then apply here.")

  const [cat] = await d.select({ slug: catalogCategories.slug }).from(catalogCategories).where(eq(catalogCategories.slug, body.category)).limit(1)
  if (!cat) throw new ApplyRefused("category", "Choose one of Yard's categories.")

  const country = body.country as CountryCode
  const currency = countries[country].currency
  const name = body.brandName.trim()
  const instagram = body.instagram?.trim() ? instagramHandleOf(body.instagram) : null
  const website = body.website?.trim() ? (/^https?:\/\//i.test(body.website.trim()) ? body.website.trim() : `https://${body.website.trim()}`) : null
  const brandId0 = current?.brandId ?? null

  // A handle: the brand's current one on a resubmission, else the first free one from its name.
  let handle: string | null = null
  if (brandId0) {
    const [b] = await d.select({ handle: brands.handle, reviewStatus: brands.reviewStatus }).from(brands).where(eq(brands.id, brandId0)).for("update").limit(1)
    if (b && (b.reviewStatus === "suspended" || b.reviewStatus === "restricted")) throw new ApplyRefused("on_hold", "Your shop is on hold by Yard, so it can't be resubmitted. Contact Yard Support.")
    handle = b?.handle ?? null
  }
  if (!handle) {
    const base = slugifyHandle(name).padEnd(3, "0").slice(0, 30)
    for (const h of handleCandidates(base, 12)) {
      if (await deps.handleFree(h, current?.id ?? null, brandId0)) {
        handle = h
        break
      }
    }
  }
  if (!handle) throw new ApplyRefused("handle", "Yard couldn't find a free shop address for that name. Try a slightly different name.")

  const city = body.city.trim()
  const values = {
    name,
    handle,
    city,
    citySlug: slugifyHandle(city) || "city",
    country,
    currency,
    categories: [body.category],
    timeZone: countryTimeZone[country] ?? "UTC",
    ...(instagram ? { instagram } : {}),
  }
  let brandId = brandId0
  if (brandId) {
    await d
      .update(brands)
      .set({ ...values, reviewStatus: "pending_review" })
      .where(eq(brands.id, brandId))
  } else {
    brandId = deps.newId("b")
    await d.insert(brands).values({ id: brandId, ...values, verified: false, reviewStatus: "pending_review", joinedAt: now.toISOString().slice(0, 10), followersBase: 0 })
    await d.insert(brandMembers).values({ id: deps.newId("tm"), brandId, userId: user.id, role: "owner", status: "active" })
  }
  const config = { ...deps.defaultStorefront, intro: body.about?.trim() ?? "", mark: { text: initialsOf(name).slice(0, 3), style: "condensed" } }
  await d
    .insert(storefrontDrafts)
    .values({ brandId, config, revision: 1, baseVersion: 0, updatedBy: user.id })
    .onConflictDoNothing({ target: storefrontDrafts.brandId })

  const data = {
    account: { name: user.name, email: user.email },
    brand: { name, handle, category: body.category, ...(body.about?.trim() ? { description: body.about.trim() } : {}) },
    business: { country, city, currency },
    short: { source: "app", instagram, website },
  }
  const steps = ["account", "brand", "business"]
  let row: OnboardingRow
  if (current?.status === "rejected") {
    ;[row] = await d
      .update(brandOnboardings)
      .set({ status: "submitted", data, completedSteps: steps, currentStep: "business", brandId, submittedAt: now, reviewNote: null, revision: current.revision + 1, updatedAt: now })
      .where(eq(brandOnboardings.id, current.id))
      .returning()
  } else {
    ;[row] = await d
      .insert(brandOnboardings)
      .values({ id: deps.newId("onb"), userId: user.id, status: "submitted", currentStep: "business", completedSteps: steps, data, revision: 1, brandId, submittedAt: now, createdAt: now, updatedAt: now })
      .returning()
  }
  return { row, created: true }
}

/* ---------- App dashboard ---------- */

/** The low-stock line Studio uses everywhere (catalog/studio.ts lowStock filter). */
export const LOW_STOCK_THRESHOLD = 3

const paymentSql = sql<string>`coalesce(${orderStates.paymentStatus}, case when ${orderRefs.status} = 'refunded' then 'refunded' when ${orderRefs.paid} then 'paid' else 'pending' end)`
const captured = sql`${paymentSql} in ('paid', 'partially_refunded')`

const emptyWindow = (): SalesWindowDto => ({ orders: 0, grossMinor: 0, refundedMinor: 0, netMinor: 0 })

/**
 * The app dashboard's numbers for one brand, read in the brand's own calendar (its time zone):
 * captured sales today, this week (the last 7 days with today) and this month (the last 30 days
 * with today), a per-day series, orders to ship, low stock and storefront views. Captured means
 * what the Studio Overview counts (orders/overview.ts).
 */
export async function dashboardNumbers(d: Db, input: { brandId: string; timeZone: string; days: 7 | 30; now?: Date }) {
  const now = input.now ?? new Date()
  const tz = input.timeZone
  const today = dateIn(tz, now.getTime())
  const from30 = shiftDate(today, -29)
  const weekFrom = shiftDate(today, -6)
  // Placed on or after the start of the oldest local day (a day's margin covers any zone offset).
  const since = new Date(`${shiftDate(from30, -1)}T00:00:00Z`)
  const localDay = sql<string>`to_char(${orderRefs.placedAt} at time zone ${tz}, 'YYYY-MM-DD')`

  const [byDay, ship, low, views] = await Promise.all([
    d
      .select({
        day: localDay,
        orders: sql<number>`count(*)::int`,
        grossMinor: sql<number>`coalesce(sum(${orderRefs.totalMinor}), 0)::bigint`.mapWith(Number),
        refundedMinor: sql<number>`coalesce(sum(${orderStates.refundedMinor}), 0)::bigint`.mapWith(Number),
      })
      .from(orderRefs)
      .leftJoin(orderStates, eq(orderStates.orderRefId, orderRefs.id))
      .where(and(eq(orderRefs.brandId, input.brandId), gte(orderRefs.placedAt, since), captured))
      // By position: the same expression twice would bind the zone as two parameters, which
      // Postgres doesn't treat as one grouping expression.
      .groupBy(sql`1`),
    d
      .select({ status: orderRefs.status, n: sql<number>`count(*)::int` })
      .from(orderRefs)
      .where(and(eq(orderRefs.brandId, input.brandId), inArray(orderRefs.status, ["paid", "processing"])))
      .groupBy(orderRefs.status),
    d
      .select({ variants: sql<number>`count(*)::int`, products: sql<number>`count(distinct ${catalogVariants.productId})::int` })
      .from(catalogVariants)
      .innerJoin(catalogProducts, eq(catalogProducts.id, catalogVariants.productId))
      .where(and(eq(catalogVariants.brandId, input.brandId), eq(catalogVariants.status, "active"), eq(catalogVariants.trackStock, true), ne(catalogProducts.status, "archived"), sql`${catalogVariants.onHand} - ${catalogVariants.held} <= ${LOW_STOCK_THRESHOLD}`)),
    d
      .select({ day: chartEvents.day, n: sql<number>`count(*)::int` })
      .from(chartEvents)
      .where(and(eq(chartEvents.brandId, input.brandId), eq(chartEvents.kind, "storefront_view"), eq(chartEvents.verdict, "counted"), gte(chartEvents.day, from30)))
      .groupBy(chartEvents.day),
  ])

  const sales = { today: emptyWindow(), week: emptyWindow(), month: emptyWindow() }
  const perDay = new Map<string, { orders: number; grossMinor: number; netMinor: number }>()
  for (const r of byDay) {
    if (r.day < from30 || r.day > today) continue
    const add = (w: SalesWindowDto) => {
      w.orders += r.orders
      w.grossMinor += r.grossMinor
      w.refundedMinor += r.refundedMinor
      w.netMinor += r.grossMinor - r.refundedMinor
    }
    add(sales.month)
    if (r.day >= weekFrom) add(sales.week)
    if (r.day === today) add(sales.today)
    perDay.set(r.day, { orders: r.orders, grossMinor: r.grossMinor, netMinor: r.grossMinor - r.refundedMinor })
  }
  const points = Array.from({ length: input.days }, (_, i) => {
    const date = shiftDate(today, i - input.days + 1)
    return { date, ...(perDay.get(date) ?? { orders: 0, grossMinor: 0, netMinor: 0 }) }
  })
  const toShip = { paid: 0, processing: 0 }
  for (const r of ship) if (r.status === "paid" || r.status === "processing") toShip[r.status] = r.n
  const storeViews = { today: 0, week: 0, month: 0 }
  for (const v of views) {
    if (v.day > today) continue
    storeViews.month += v.n
    if (v.day >= weekFrom) storeViews.week += v.n
    if (v.day === today) storeViews.today += v.n
  }
  return {
    sales,
    series: { days: input.days, points },
    toShip: { total: toShip.paid + toShip.processing, ...toShip },
    lowStock: { variants: low[0]?.variants ?? 0, products: low[0]?.products ?? 0, threshold: LOW_STOCK_THRESHOLD },
    storeViews,
  }
}

/* ---------- Studio push preferences ---------- */

export type PushPrefs = { orders: boolean; messages: boolean; lowStock: boolean; payouts: boolean }
export const DEFAULT_PUSH_PREFS: PushPrefs = { orders: true, messages: true, lowStock: true, payouts: true }

export async function pushPrefsOf(d: Db, userId: string, brandId: string): Promise<PushPrefs> {
  const [r] = await d.select().from(studioPushPreferences).where(and(eq(studioPushPreferences.userId, userId), eq(studioPushPreferences.brandId, brandId))).limit(1)
  return r ? { orders: r.orders, messages: r.messages, lowStock: r.lowStock, payouts: r.payouts } : { ...DEFAULT_PUSH_PREFS }
}

export async function savePushPrefs(d: Db, userId: string, brandId: string, patch: Partial<PushPrefs>): Promise<PushPrefs> {
  const next = { ...(await pushPrefsOf(d, userId, brandId)), ...Object.fromEntries(Object.entries(patch).filter(([, v]) => typeof v === "boolean")) } as PushPrefs
  await d
    .insert(studioPushPreferences)
    .values({ userId, brandId, ...next, updatedAt: new Date() })
    .onConflictDoUpdate({ target: [studioPushPreferences.userId, studioPushPreferences.brandId], set: { ...next, updatedAt: new Date() } })
  return next
}

/** The users among `userIds` who want `topic` pushes from `brandId` (no row = on). */
export async function wantingPush(d: Db, brandId: string, userIds: string[], topic: keyof PushPrefs): Promise<string[]> {
  if (!userIds.length) return []
  const rows = await d.select().from(studioPushPreferences).where(and(eq(studioPushPreferences.brandId, brandId), inArray(studioPushPreferences.userId, userIds)))
  const off = new Set(rows.filter((r) => !r[topic]).map((r) => r.userId))
  return userIds.filter((u) => !off.has(u))
}

/** Active brand members (never Yard setup) whose role is one of `roles`, with their account status. */
export async function brandMembersIn(d: Db, brandId: string, roles: readonly string[]) {
  const rows = await d
    .select({ userId: brandMembers.userId, role: brandMembers.role, status: users.status })
    .from(brandMembers)
    .innerJoin(users, eq(users.id, brandMembers.userId))
    .where(and(eq(brandMembers.brandId, brandId), eq(brandMembers.status, "active"), inArray(brandMembers.role, [...roles])))
  return rows.filter((r) => r.status !== "suspended" && r.role !== "yard_setup")
}
