import { websiteCreateBody } from "@/lib/api/contracts/from-website"
import { createFromWebsite } from "@/server/catalog/from-website"
import { idParam } from "@/server/catalog/params"
import { json, route } from "@/server/http/route"

/**
 * POST /api/admin/founding-brands/from-website/{importId}/create { brand: { name, handle, category,
 * city, country, currency, story?, instagram?, tiktok?, idempotencyKey }, logoUrl, bannerUrl,
 * products: [...], goLiveOnClaim, watch, foundingBadge } (brands.founding + catalog.propose) →
 * 201 (200 on a replay of the same key) { import, suggestion, duplicates, created }. Creates the
 * unclaimed founding brand, attaches the scan, applies the toggles, starts the import (products
 * as Suggestions from Yard, logo and banner into the storefront draft) and turns on watching.
 * Each step is audited; a replay only finishes what's missing.
 */
export const POST = route(
  { auth: "admin", permission: "brands.founding", body: websiteCreateBody, maxBody: 512 * 1024, rate: { key: "admin.founding.create", limit: 20, windowSec: 3600, daily: 100 } },
  async ({ actor, params, body, ipHash }) => {
    const r = await createFromWebsite(actor, idParam(params, "id"), body, ipHash)
    return json(r.scan, r.status)
  },
)
