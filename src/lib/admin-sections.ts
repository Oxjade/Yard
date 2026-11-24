import { canAdmin, canAdminFinance, type AdminPermission, type AdminRole } from "./permissions"

/**
 * Which Control Center sections a role may open, by address. The same rule the navigation uses to
 * show an item (src/components/admin/admin-shell.tsx `sees`), applied on the server before the
 * page renders (GET /api/pages/access, src/proxy.ts): an admin without it gets the calm "You don't
 * have access to this" page instead of the section. Sections not listed are open to every admin
 * role (their APIs still check each permission).
 */
type Rule = { prefix: string; allowed: (role: AdminRole) => boolean }

const anyOf =
  (...p: AdminPermission[]) =>
  (role: AdminRole) =>
    p.some((x) => canAdmin(role, x))

export const ADMIN_SECTION_RULES: readonly Rule[] = [
  { prefix: "/admin/finance", allowed: canAdminFinance },
  { prefix: "/admin/orders", allowed: anyOf("shipping.view") },
  { prefix: "/admin/delivery", allowed: anyOf("shipping.view") },
  { prefix: "/admin/support", allowed: anyOf("support.manage") },
  { prefix: "/admin/newsletter", allowed: anyOf("comms.newsletter") },
  { prefix: "/admin/messages", allowed: anyOf("messages.view_reports") },
  { prefix: "/admin/content", allowed: anyOf("content.moderate", "places.moderate", "social.manage") },
  { prefix: "/admin/charts", allowed: anyOf("charts.review", "sponsored.view") },
  { prefix: "/admin/health", allowed: anyOf("audit.view") },
]

/** Whether `role` may open the Control Center page at `path`. */
export function adminSectionAllowed(path: string, role: AdminRole): boolean {
  const rule = ADMIN_SECTION_RULES.find((r) => path === r.prefix || path.startsWith(`${r.prefix}/`))
  return rule ? rule.allowed(role) : true
}
