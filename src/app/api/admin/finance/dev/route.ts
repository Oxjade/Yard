import { connection, type NextRequest } from "next/server"
import { z } from "zod"
import { getEnv } from "@/server/env"
import { route } from "@/server/http/route"
import { ageAccount, KIT_BRANDS, reconcileAhead, releaseReservesFor, scanAccountNumber, setMember } from "@/server/ledger/dev"

/**
 * Test-only helpers for the LEDGER acceptance kit (scripts/checks/v3-ledger.mjs). DEVELOPMENT ONLY:
 * 404 in production before anything else runs. Limited to the kit brands and kit-tagged rows.
 *
 * POST { op: "age-account", brandId, hours }            → skip the bank-change cooldown
 * POST { op: "member", brandId, userId, role, on }       → add / remove a kit membership
 * POST { op: "release-reserves", orderIds, at }          → reserve release job over those orders as of `at`
 * POST { op: "scan-account", brandId, accountNumber }    → tables whose rows contain the number as text
 * POST { op: "reconcile-ahead", hoursAhead }             → a reconciliation run as of now + hoursAhead
 */
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)
const brandId = z.enum(KIT_BRANDS)
const body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("age-account"), brandId, hours: z.number().min(0).max(24 * 60) }).strict(),
  z.object({ op: z.literal("member"), brandId, userId: id, role: z.enum(["admin", "designer", "fulfilment", "finance", "viewer"]), on: z.boolean() }).strict(),
  z.object({ op: z.literal("release-reserves"), orderIds: z.array(id).min(1).max(50), at: z.iso.datetime({ offset: true }) }).strict(),
  z.object({ op: z.literal("scan-account"), brandId, accountNumber: z.string().regex(/^[0-9]{6,20}$/) }).strict(),
  z.object({ op: z.literal("reconcile-ahead"), hoursAhead: z.number().min(1).max(6) }).strict(),
])

const handler = route({ auth: "public", body, maxBody: 4 * 1024 }, async ({ body }) => {
  switch (body.op) {
    case "age-account":
      return ageAccount(body.brandId, body.hours)
    case "member":
      return setMember(body.brandId, body.userId, body.role, body.on)
    case "release-reserves":
      return releaseReservesFor(body.orderIds, new Date(body.at))
    case "scan-account":
      return scanAccountNumber(body.brandId, body.accountNumber)
    case "reconcile-ahead":
      return reconcileAhead(body.hoursAhead)
  }
})

const off = () => Response.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 })

export async function POST(req: NextRequest, ctx: { params: Promise<Record<string, string | string[]>> }) {
  await connection()
  if (!getEnv().dev) return off()
  return handler(req, ctx)
}
