import "server-only"
import { and, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm"
import { db } from "../db"
import { adminMembers, brandMembers, brands, oauthIdentities, orderStates, userCredentials, users } from "../db/schema"
import { getEnv } from "../env"

/** One account in the Control Center's Users directory. */
export type AdminUserRow = {
  id: string
  name: string
  email: string
  kind: "shopper" | "brand_staff" | "admin"
  status: "active" | "restricted" | "suspended"
  country: string | null
  city: string | null
  joinedAt: string
  lastActive: string
  emailVerified: boolean
  /** How they sign in: "password", "google", "auth0:google-oauth2", … */
  methods: string[]
  orders: number
  brands: string[]
  adminRole: string | null
  demo: boolean
}

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null)

/**
 * Every account, newest first (max 500 per call), optionally searched by name or email. Demo
 * accounts are left out unless sample data is on, so production lists only real people.
 */
export async function listAdminUsers(opts: { q?: string; limit?: number } = {}): Promise<{ items: AdminUserRow[]; total: number }> {
  const d = await db()
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 500)
  const where: SQL[] = []
  if (!getEnv().seedDemo) where.push(eq(users.demo, false))
  const q = opts.q?.trim()
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    where.push(or(ilike(users.name, like), ilike(users.email, like))!)
  }
  const cond = where.length ? and(...where) : undefined

  const [rows, [{ total }]] = await Promise.all([
    d
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        kind: users.kind,
        status: users.status,
        country: users.country,
        city: users.city,
        demo: users.demo,
        createdAt: users.createdAt,
        emailVerifiedAt: userCredentials.emailVerifiedAt,
        hasPassword: sql<boolean>`${userCredentials.passwordHash} is not null`,
        lastSignInAt: userCredentials.lastSignInAt,
        adminRole: adminMembers.role,
      })
      .from(users)
      .leftJoin(userCredentials, eq(userCredentials.userId, users.id))
      .leftJoin(adminMembers, eq(adminMembers.userId, users.id))
      .where(cond)
      .orderBy(desc(users.createdAt))
      .limit(limit),
    d.select({ total: sql<number>`count(*)::int` }).from(users).where(cond),
  ])
  const ids = rows.map((r) => r.id)
  if (!ids.length) return { items: [], total: Number(total) }

  const [idents, orderCounts, memberships] = await Promise.all([
    d.select({ userId: oauthIdentities.userId, provider: oauthIdentities.provider, subject: oauthIdentities.subject, lastUsedAt: oauthIdentities.lastUsedAt }).from(oauthIdentities).where(inArray(oauthIdentities.userId, ids)),
    d.select({ customerId: orderStates.customerId, n: sql<number>`count(*)::int` }).from(orderStates).where(inArray(orderStates.customerId, ids)).groupBy(orderStates.customerId),
    d.select({ userId: brandMembers.userId, name: brands.name }).from(brandMembers).innerJoin(brands, eq(brands.id, brandMembers.brandId)).where(and(inArray(brandMembers.userId, ids), eq(brandMembers.status, "active"))),
  ])

  const methods = new Map<string, Set<string>>()
  const lastOauth = new Map<string, string>()
  for (const i of idents) {
    const label = i.provider === "auth0" ? (i.subject.split("|")[0] || "auth0") : i.provider
    const set = methods.get(i.userId) ?? new Set<string>()
    set.add(label === "google-oauth2" ? "google" : label)
    methods.set(i.userId, set)
    const used = iso(i.lastUsedAt)
    if (used && (!lastOauth.has(i.userId) || used > lastOauth.get(i.userId)!)) lastOauth.set(i.userId, used)
  }
  const orders = new Map(orderCounts.map((o) => [o.customerId, Number(o.n)]))
  const brandNames = new Map<string, string[]>()
  for (const m of memberships) brandNames.set(m.userId, [...(brandNames.get(m.userId) ?? []), m.name])

  const items = rows.map<AdminUserRow>((r) => {
    const m = [...(r.hasPassword ? ["password"] : []), ...(methods.get(r.id) ?? [])]
    const joined = iso(r.createdAt)!
    const signedIn = [iso(r.lastSignInAt), lastOauth.get(r.id) ?? null].filter(Boolean).sort().pop() ?? joined
    return {
      id: r.id,
      name: r.name,
      email: r.email,
      kind: r.kind as AdminUserRow["kind"],
      status: r.status as AdminUserRow["status"],
      country: r.country,
      city: r.city,
      joinedAt: joined,
      lastActive: signedIn,
      emailVerified: !!r.emailVerifiedAt || (methods.get(r.id)?.size ?? 0) > 0,
      methods: m,
      orders: orders.get(r.id) ?? 0,
      brands: brandNames.get(r.id) ?? [],
      adminRole: r.adminRole ?? null,
      demo: r.demo,
    }
  })
  return { items, total: Number(total) }
}
