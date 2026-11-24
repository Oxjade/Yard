import { and, eq, ne } from "drizzle-orm"
import { z } from "zod"
import { adminSectionAllowed } from "@/lib/admin-sections"
import type { AdminAccess, StudioAccess } from "@/lib/access-gate"
import { getAdmin, getBrandActor, getShopper } from "@/server/auth/dal"
import { db } from "@/server/db"
import { brandMembers } from "@/server/db/schema"
import { json, route } from "@/server/http/route"

const query = z.object({
  area: z.enum(["admin", "studio"]),
  path: z.string().max(2048).regex(/^\/[^\s]*$/).optional(),
})

/**
 * GET /api/pages/access?area=admin&path=/admin/finance | ?area=studio — the server's half of the
 * page gate (src/lib/access-gate.ts). src/proxy.ts asks it, with the visitor's cookies, before a
 * Control Center page renders (and before a Studio page renders for a shopper without a brand
 * session). It answers only about the caller's own sessions, never about anyone else:
 *  - admin: { admin, permitted, signedIn } — a live admin session, whether its role may open
 *    `path` (src/lib/admin-sections.ts), and whether a shopper or brand session is live instead;
 *  - studio: { shopper, brandMember } — a live shopper session, and whether it belongs to any brand.
 */
export const GET = route({ auth: "public", query, cache: "no-store", rate: { key: "pages.access", limit: 600, windowSec: 60 } }, async ({ query: q }) => {
  if (q.area === "admin") {
    const admin = await getAdmin()
    if (admin) return json({ admin: true, permitted: adminSectionAllowed(q.path ?? "/admin", admin.role), signedIn: true } satisfies AdminAccess)
    const [shopper, brand] = await Promise.all([getShopper(), getBrandActor()])
    return json({ admin: false, permitted: false, signedIn: !!(shopper || brand) } satisfies AdminAccess)
  }
  const shopper = await getShopper()
  if (!shopper) return json({ shopper: false, brandMember: false } satisfies StudioAccess)
  const d = await db()
  const [member] = await d
    .select({ id: brandMembers.id })
    .from(brandMembers)
    .where(and(eq(brandMembers.userId, shopper.userId), eq(brandMembers.status, "active"), ne(brandMembers.role, "yard_setup")))
    .limit(1)
  return json({ shopper: true, brandMember: !!member } satisfies StudioAccess)
})
