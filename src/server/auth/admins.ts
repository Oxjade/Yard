import "server-only"
import { eq } from "drizzle-orm"
import { adminRoleLabels, type AdminRole } from "@/lib/permissions"
import { writeAudit } from "../audit"
import { db, withTx } from "../db"
import { adminMembers, users } from "../db/schema"
import { HttpError, badRequest, forbidden } from "../http/errors"
import { newId } from "../ids"
import { authLinks } from "./auth-env"
import type { AdminActor } from "./dal"
import { AUTH_EMAIL_TEMPLATES, findUserByEmail, normalizeEmail, sendAuthEmail, upsertCredentials, type RequestMeta } from "./identity"
import { issueToken } from "./tokens"

/**
 * Real admin accounts (v3). Seeded admins are demo accounts (demo = true) and never get a
 * password. An owner admin creates a real admin here: a users row (kind admin, demo = false), an
 * admin_members row and a 72-hour "set your password" link (the reset template). The new admin
 * sets a password, signs in, and enrols TOTP at that first sign-in.
 *
 * Bootstrapping the very first real owner (no owner exists yet) is an ops step: call
 * createAdminAccount(null, …) from a one-off script (the orchestrator wires it; see hand-off).
 */
export async function createAdminAccount(actor: AdminActor | null, input: { email: string; name: string; role: AdminRole }, meta: RequestMeta) {
  if (actor && actor.role !== "owner") throw forbidden("Only an owner can add admins.")
  if (actor?.demo) throw new HttpError(422, "rule", "Demo admins can't create real admin accounts.")
  const email = normalizeEmail(input.email)
  if (await findUserByEmail(email)) throw badRequest({ email: "An account with this email already exists." })
  return withTx(async (tx) => {
    const d = await db()
    const id = newId("adm")
    await d.insert(users).values({ id, kind: "admin", name: input.name.trim(), email, status: "active", demo: false })
    await d.insert(adminMembers).values({ userId: id, role: input.role, mfa: false })
    await upsertCredentials(id, {})
    const t = await issueToken(id, "reset_password", { email }, { ttlMinutes: 72 * 60 })
    await sendAuthEmail(tx, AUTH_EMAIL_TEMPLATES.resetPassword, email, { name: input.name.trim(), url: authLinks.resetPassword(t.token), expiresMinutes: t.ttlMinutes }, `admin-onboard:${id}`)
    await writeAudit({
      actor: actor ? { kind: "admin", id: actor.userId, name: actor.name, role: actor.role } : { kind: "system" },
      action: "admin.account_created",
      target: input.name.trim(),
      subjectType: "user",
      subjectId: id,
      ipHash: meta.ipHash,
      meta: { role: input.role, roleLabel: adminRoleLabels[input.role] },
    })
    const [row] = await d.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, id)).limit(1)
    return { admin: { ...row, role: input.role } }
  })
}
