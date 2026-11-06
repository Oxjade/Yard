import type { ADMIN_ROLES, TEAM_ROLES } from "@/lib/api/contracts/enums"

/**
 * The v2 permission model (§2.4). Isomorphic: the server checks it in the route wrapper and the
 * DAL, and the UI uses the same table for disabled reasons, so the two can never disagree.
 */

export type TeamRole = (typeof TEAM_ROLES)[number]
export type AdminRole = (typeof ADMIN_ROLES)[number]

export const BRAND_PERMISSIONS = ["inbox.read", "inbox.reply", "inbox.manage", "social.connect", "content.publish", "locations.manage", "shipping.manage", "orders.fulfil"] as const
export type BrandPermission = (typeof BRAND_PERMISSIONS)[number]

export const ADMIN_PERMISSIONS = [
  "messages.view_reports",
  "messages.moderate",
  "content.moderate",
  "places.moderate",
  "social.manage",
  "charts.review",
  "charts.freeze",
  "shipping.view",
  "shipping.resolve",
  "abuse.view",
  "users.restrict",
  "brands.restrict",
  "holidays.edit",
  "audit.view",
  "sponsored.view",
] as const
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number]

const ALL_BRAND = [...BRAND_PERMISSIONS]
const ALL_ADMIN = [...ADMIN_PERMISSIONS]

export const brandRolePermissions: Record<TeamRole, BrandPermission[]> = {
  owner: ALL_BRAND,
  admin: ALL_BRAND,
  designer: ["inbox.read", "social.connect", "content.publish"],
  fulfilment: ["inbox.read", "inbox.reply", "inbox.manage", "orders.fulfil", "shipping.manage"],
  finance: ["inbox.read"],
  viewer: ["inbox.read"],
}

export const adminRolePermissions: Record<AdminRole, AdminPermission[]> = {
  owner: ALL_ADMIN,
  trust_safety: [
    "messages.view_reports",
    "messages.moderate",
    "content.moderate",
    "places.moderate",
    "social.manage",
    "charts.review",
    "charts.freeze",
    "abuse.view",
    "users.restrict",
    "brands.restrict",
    "audit.view",
    "shipping.view",
  ],
  support: ["messages.view_reports", "shipping.view", "shipping.resolve", "abuse.view"],
  ads_ops: ["charts.review", "sponsored.view"],
  engineering: ["social.manage", "holidays.edit", "audit.view", "shipping.view"],
  finance: ["shipping.view", "audit.view"],
}

export const teamRoleLabels: Record<TeamRole, string> = {
  owner: "Owner",
  admin: "Admin",
  designer: "Designer",
  fulfilment: "Fulfilment",
  finance: "Finance",
  viewer: "Viewer",
}

export const adminRoleLabels: Record<AdminRole, string> = {
  owner: "Owner",
  finance: "Finance",
  trust_safety: "Trust & safety",
  support: "Support",
  ads_ops: "Ads operations",
  engineering: "Engineering",
}

/** One plain label per brand permission, for disabled reasons ("Your role can't {label}"). */
export const brandPermissionLabels: Record<BrandPermission, string> = {
  "inbox.read": "read messages",
  "inbox.reply": "reply to messages",
  "inbox.manage": "manage conversations",
  "social.connect": "connect social accounts",
  "content.publish": "publish posts",
  "locations.manage": "manage locations",
  "shipping.manage": "change shipping settings",
  "orders.fulfil": "update shipments",
}

/**
 * One plain label per admin permission. The Team matrix generates its v2 rows from these
 * (§2.4), so the two vocabularies can't drift.
 */
export const adminPermissionLabels: Record<AdminPermission, string> = {
  "messages.view_reports": "view message reports",
  "messages.moderate": "moderate messages",
  "content.moderate": "moderate posts",
  "places.moderate": "moderate places and events",
  "social.manage": "manage social integrations",
  "charts.review": "review chart integrity",
  "charts.freeze": "freeze brands on Charts",
  "shipping.view": "view delivery issues",
  "shipping.resolve": "resolve delivery issues",
  "abuse.view": "view abuse signals",
  "users.restrict": "restrict accounts",
  "brands.restrict": "restrict brands",
  "holidays.edit": "edit holidays",
  "audit.view": "view the audit log",
  "sponsored.view": "view sponsored placements",
}

const brandSet = new Set<string>(BRAND_PERMISSIONS)
export const isBrandPermission = (p: string): p is BrandPermission => brandSet.has(p)
export const isAdminPermission = (p: string): p is AdminPermission => (ADMIN_PERMISSIONS as readonly string[]).includes(p)

export function canBrand(role: TeamRole, permission: BrandPermission | "any_member") {
  return permission === "any_member" || (brandRolePermissions[role] ?? []).includes(permission)
}

export function canAdmin(role: AdminRole, permission: AdminPermission | "any_admin") {
  return permission === "any_admin" || (adminRolePermissions[role] ?? []).includes(permission)
}

/** Brand and admin permission names are disjoint, so the permission says which table to read. */
export function can(role: TeamRole | AdminRole, permission: BrandPermission | AdminPermission) {
  if (isBrandPermission(permission)) return role in brandRolePermissions && canBrand(role as TeamRole, permission)
  return role in adminRolePermissions && canAdmin(role as AdminRole, permission)
}

const list = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`)

/**
 * The disabled reason for a missing permission: "Needs the Trust & safety role". Owner (and the
 * brand Admin role) hold everything, so they're named only when nobody else holds it.
 */
export function needsRole(permission: BrandPermission | AdminPermission) {
  if (isBrandPermission(permission)) {
    const roles = (Object.keys(brandRolePermissions) as TeamRole[]).filter((r) => r !== "owner" && r !== "admin" && brandRolePermissions[r].includes(permission))
    return `Needs the ${list((roles.length ? roles : (["owner", "admin"] as TeamRole[])).map((r) => teamRoleLabels[r]))} role`
  }
  const roles = (Object.keys(adminRolePermissions) as AdminRole[]).filter((r) => r !== "owner" && adminRolePermissions[r].includes(permission))
  return `Needs the ${list((roles.length ? roles : (["owner"] as AdminRole[])).map((r) => adminRoleLabels[r]))} role`
}

/** "Your role (Fulfilment) can't connect social accounts. Ask an owner or admin." */
export function roleCantSentence(role: TeamRole, permission: BrandPermission) {
  return `Your role (${teamRoleLabels[role]}) can't ${brandPermissionLabels[permission]}. Ask an owner or admin.`
}
