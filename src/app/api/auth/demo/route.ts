import { headers } from "next/headers"
import { demoActorQuery, demoSignInBody, type AdminProfile, type BrandProfile, type ShopperProfile } from "@/lib/api/contracts/session"
import { adminRolePermissions, brandRolePermissions, type AdminRole, type TeamRole } from "@/lib/permissions"
import { writeAudit } from "@/server/audit"
import { getAdmin } from "@/server/auth/dal"
import { demoAuthEnabled, eligibleAccount, listDemoAccounts } from "@/server/auth/demo-accounts"
import { clearSessionCookie, createSession, endCurrentSession, type ActorKind } from "@/server/auth/session"
import { db, withTx } from "@/server/db"
import { getEnv } from "@/server/env"
import { notFound, rateLimited } from "@/server/http/errors"
import { route } from "@/server/http/route"
import { hit, recordAbuse } from "@/server/security/rate-limit"

/**
 * Demo sign-in and sign-out (§2.3): the ONE code path that creates a demo session, gated by
 * demoAuthEnabled(actor). Route Handlers (not Server Actions), so CSRF, rate limits and the
 * error format apply, and the cookie is set on this response.
 */

const off = () => notFound("Demo sign-in is off.")

/** GET /api/auth/demo?actor=: the accounts a picker may offer (404 when that actor's demo sign-in is off). */
export const GET = route({ auth: "public", query: demoActorQuery }, async ({ query }) => {
  if (!demoAuthEnabled(query.actor)) throw off()
  return { accounts: await listDemoAccounts(query.actor) }
})

/** Production: 20 per 10 min per IP (one global bucket when the IP is unknown). Development: 60 per 10 min per (IP, account). */
async function limit(account: string, ipHash: string | null) {
  const env = getEnv()
  const key = env.dev ? `auth.demo:${ipHash ?? "unknown"}:${account}` : `auth.demo:${ipHash ?? "global"}`
  const r = hit(key, env.dev ? 60 : 20, 600)
  if (!r.ok) {
    await recordAbuse(key, { kind: "anon", id: null, ipHash }, "auth.demo", "rate_limit", { account }).catch(() => {})
    throw rateLimited(r.retryAfter, "Too many sign-ins from here. Try again in a few minutes.")
  }
}

/**
 * The new session's profile, built from the rows: the cookie set on this response isn't readable
 * through cookies() in the same request.
 */
async function profileFor(actor: ActorKind, user: { id: string; name: string; email: string; status: string; demo: boolean }, brandId: string | null): Promise<ShopperProfile | BrandProfile | AdminProfile> {
  const d = await db()
  if (actor === "shopper") return { id: user.id, name: user.name, email: user.email, status: user.status as ShopperProfile["status"], demo: user.demo }
  if (actor === "admin") {
    const m = await d.query.adminMembers.findFirst({ where: (x, { eq }) => eq(x.userId, user.id) })
    const role = (m?.role ?? "support") as AdminRole
    return { id: user.id, name: user.name, role, permissions: adminRolePermissions[role], demo: user.demo }
  }
  const [b, m] = await Promise.all([
    d.query.brands.findFirst({ where: (x, { eq }) => eq(x.id, brandId ?? "") }),
    d.query.brandMembers.findFirst({ where: (x, { and, eq }) => and(eq(x.brandId, brandId ?? ""), eq(x.userId, user.id)) }),
  ])
  const role = (m?.role ?? "viewer") as TeamRole
  return {
    userId: user.id,
    name: user.name,
    brand: { id: b!.id, handle: b!.handle, name: b!.name, reviewStatus: b!.reviewStatus as BrandProfile["brand"]["reviewStatus"] },
    role,
    permissions: brandRolePermissions[role],
    demo: user.demo,
  }
}

/** POST /api/auth/demo { actor, account, brandId? } */
export const POST = route({ auth: "public", body: demoSignInBody, maxBody: 2 * 1024 }, async ({ body, ipHash }) => {
  const actor: ActorKind = body.actor
  if (!demoAuthEnabled(actor)) throw off()
  await limit(body.account, ipHash)
  const { user, activeBrandId } = await eligibleAccount(actor, body.account, body.brandId)
  const userAgent = (await headers()).get("user-agent")
  await withTx(async () => {
    // A sign-in or switch first ends this browser's previous session of the same kind (§2.1), so
    // its stream closes at once (session.ended is published after commit).
    const previous = await endCurrentSession(actor, "replaced")
    const d = await db()
    if (previous && actor === "admin") {
      // Switching admins (e.g. Aisha → Ngozi) ends Aisha's session: the audit log says so (§8.3).
      const [prevUser, prevMember] = await Promise.all([
        d.query.users.findFirst({ where: (u, { eq }) => eq(u.id, previous.userId) }),
        d.query.adminMembers.findFirst({ where: (m, { eq }) => eq(m.userId, previous.userId) }),
      ])
      await writeAudit({
        actor: { kind: "admin", id: previous.userId, name: prevUser?.name ?? null, role: prevMember?.role ?? null },
        action: "admin.signed_out",
        target: prevUser?.name ?? previous.userId,
        subjectType: "session",
        subjectId: previous.id,
        reason: previous.userId === user.id ? "Signed in again" : `Switched to ${user.name}`,
        ipHash,
        meta: { demo: true, cause: "switched" },
      })
    }
    const row = await createSession(actor, user.id, activeBrandId, { userAgent, ipHash })
    if (actor === "admin") {
      const member = await d.query.adminMembers.findFirst({ where: (m, { eq }) => eq(m.userId, user.id) })
      await writeAudit({ actor: { kind: "admin", id: user.id, name: user.name, role: member?.role ?? null }, action: "admin.signed_in", target: user.name, subjectType: "session", subjectId: row.id, ipHash, meta: { demo: true } })
    }
  })
  return { actor, profile: await profileFor(actor, user, activeBrandId) }
})

/**
 * DELETE /api/auth/demo?actor=. Only sign-IN is gated on the demo flag: signing out always
 * deletes this browser's session of that kind and clears its cookie, so nobody is ever left
 * holding a session they can't end.
 */
export const DELETE = route({ auth: "public", query: demoActorQuery }, async ({ query, ipHash }) => {
  const actor: ActorKind = query.actor
  const admin = actor === "admin" ? await getAdmin() : null
  await withTx(async () => {
    const row = await endCurrentSession(actor, "signed_out")
    if (row && admin) await writeAudit({ actor: { kind: "admin", id: admin.userId, name: admin.name, role: admin.role }, action: "admin.signed_out", target: admin.name, subjectType: "session", subjectId: row.id, ipHash })
  })
  await clearSessionCookie(actor)
  return { ok: true }
})
