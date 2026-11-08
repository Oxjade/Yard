import "server-only"
import { requireRecentReauth } from "@/server/auth/reauth"
import type { AdminActor, BrandActor } from "../auth/dal"
import { forbidden } from "../http/errors"
import { ADMIN_FINANCE_ROLES, BANK_ACCOUNT_ROLES, FINANCE_REQUEST_ROLES, FINANCE_VIEW_ROLES, ledgerConfig } from "./config"

/**
 * Role gates for money surfaces. src/lib/permissions.ts has no finance permissions yet, so routes
 * use 'any_member' / 'any_admin' and these checks narrow to the finance roles.
 */
const has = (list: readonly string[], role: string) => list.includes(role)

export function assertBrandFinanceView(actor: BrandActor) {
  if (!has(FINANCE_VIEW_ROLES, actor.role)) throw forbidden("Only owners, admins and finance can see payouts.")
}
export function assertBrandPayoutRequest(actor: BrandActor) {
  if (!has(FINANCE_REQUEST_ROLES, actor.role)) throw forbidden("Only owners, admins and finance can request payouts.")
}
export function assertBankAccountEditor(actor: BrandActor) {
  if (!has(BANK_ACCOUNT_ROLES, actor.role)) throw forbidden("Only the brand owner can change the payout account.")
}
export function assertAdminFinance(actor: AdminActor) {
  if (!has(ADMIN_FINANCE_ROLES, actor.role)) throw forbidden("Needs the Finance role.")
}

/** Money actions need a recent re-authentication (AUTH's requireRecentReauth: TOTP / password within the window). */
export async function assertRecentReauth(actor: AdminActor | BrandActor) {
  await requireRecentReauth(actor, ledgerConfig.reauthMaxAgeSec)
}
