import "server-only"
import type { BrandProfile } from "@/lib/api/contracts/session"
import type { StudioApplicationDto, StudioApplyBody, StudioApplyResult, StudioDashboardDto, StudioPushPreferencesDto } from "@/lib/api/contracts/studio-app"
import { canBrand } from "@/lib/permissions"
import { writeAudit } from "../audit"
import type { BrandActor, ShopperActor } from "../auth/dal"
import { profileFor, userById, type RequestMeta } from "../auth/identity"
import { createSession, endCurrentSession, sessionsAllowed } from "../auth/session"
import { sessionAuthOf } from "../auth/session-auth"
import { handleStatus } from "../catalog/onboarding"
import { catalogChanged } from "../catalog/hooks"
import { kickImports } from "../catalog/importer/service"
import { startUrlOf } from "../catalog/importer/scan"
import { cleanUrl, ImportUrlError } from "../catalog/importer/url"
import { studioPieces } from "../catalog/importer/watch"
import { DEFAULT_STOREFRONT } from "../catalog/storefront"
import { db, withTx } from "../db"
import { sessionAuth } from "../db/schema/identity"
import { catalogImports } from "../db/schema/imports"
import { badRequest, conflict, forbidden, HttpError, rule, suspended } from "../http/errors"
import { newId } from "../ids"
import { unreadBrand } from "../inbox/service"
import { log } from "../log"
import { studioOverview } from "../orders/overview"
import { sendStudioPush } from "../push/studio"
import { hit } from "../security/rate-limit"
import { applicationDto, ApplyRefused, dashboardNumbers, latestApplication, membershipsOf, pushPrefsOf, savePushPrefs, switchTarget, writeShortApplication, type PushPrefs } from "./core"

/**
 * Studio in the Yard apps: the request half (docs/APP.md › Studio in the app). The database
 * statements are in core.ts (tested on PGlite).
 */

/* ---------- Session: memberships and the switch ---------- */

/** The shopper's brands for GET /api/session (`shopper.brands`). */
export async function sessionBrands(userId: string) {
  return membershipsOf(await db(), userId)
}

/**
 * Opens a brand (Studio) session on `brandId` for the signed-in shopper, in this client's cookie
 * jar (`yard_b`), without a second sign-in. Only for an active member (not Yard setup) of a brand
 * that isn't suspended; anyone else gets 403 and no cookie. The brand session records the same
 * sign-in method as the shopper session and inherits its re-confirmation time (never a fresh one),
 * so money actions (refunds, paid cancels, the payout account) still ask to re-confirm as they do
 * on the website. Brand sessions need no MFA (only admin sessions do), and the admin session is
 * never touched. Replaces this client's previous brand session.
 */
export async function switchToBrand(shopper: ShopperActor, brandId: string, meta: RequestMeta): Promise<{ actor: "brand"; profile: BrandProfile }> {
  const d = await db()
  const t = await switchTarget(d, shopper.userId, brandId)
  if (!t.ok) throw t.reason === "suspended" ? suspended("This brand is suspended by Yard.") : forbidden("You aren't a member of this brand.")
  const how = await sessionAuthOf(shopper.sessionId)
  const real = !!how && how.method !== "demo"
  // A demo shopper's brand session is a demo session: only where demo brand sign-in is on.
  if (!real && !sessionsAllowed("brand")) throw forbidden("Demo accounts can't open Studio on this site.")
  const user = await userById(shopper.userId)
  if (!user || user.status === "suspended") throw suspended("This account is suspended.")
  return withTx(async () => {
    await endCurrentSession("brand", "replaced")
    const row = await createSession("brand", user.id, t.brandId, meta)
    if (real) {
      const tx = await db()
      await tx.insert(sessionAuth).values({ sessionId: row.id, userId: user.id, method: how!.method, mfaAt: null, reauthAt: how!.reauthAt })
    }
    return { actor: "brand" as const, profile: (await profileFor("brand", user, t.brandId)) as BrandProfile }
  })
}

/* ---------- The short application ---------- */

export async function getApplication(shopper: ShopperActor): Promise<{ application: StudioApplicationDto | null }> {
  const d = await db()
  const row = await latestApplication(d, shopper.userId)
  return { application: row ? await applicationDto(d, row) : null }
}

/**
 * POST /api/studio/apply: the app's short "Sell on Yard" application. Lands in Admin › Brands
 * pending review like a website application. With a website, Yard pre-scans it with the importer
 * (the brand's own consent: they gave us their site to review), so the reviewer finds the products
 * ready under the brand's Import from website; nothing is suggested or published until an admin
 * imports it.
 */
export async function applyFromApp(shopper: ShopperActor, body: StudioApplyBody, ipHash: string | null): Promise<{ status: 200 | 201; result: StudioApplyResult }> {
  if (shopper.demo) throw rule("Demo accounts can't apply to sell on Yard.")
  let created = false
  let row
  try {
    const out = await withTx(async () => {
      const d = await db()
      return writeShortApplication(d, { id: shopper.userId, name: shopper.name, email: shopper.email }, body, {
        newId,
        handleFree: async (h, onb, brand) => (await handleStatus(h, onb ?? undefined, brand)) === "available",
        defaultStorefront: DEFAULT_STOREFRONT as unknown as Record<string, unknown>,
      })
    })
    created = out.created
    row = out.row
  } catch (e) {
    if (e instanceof ApplyRefused) {
      if (e.kind === "category") throw badRequest({ category: e.message })
      if (e.kind === "open_draft") throw conflict(e.message)
      throw rule(e.message)
    }
    throw e
  }
  const d = await db()
  let websiteScan: StudioApplyResult["websiteScan"] = null
  if (created) {
    const short = (row.data as { short?: { instagram?: string | null; website?: string | null } }).short
    await writeAudit({ actor: { kind: "shopper", id: shopper.userId, name: shopper.name }, action: "onboarding.submitted", target: body.brandName.trim(), subjectType: "brand_onboarding", subjectId: row.id, brandId: row.brandId ?? undefined, ipHash, meta: { short: true, source: "app", country: body.country, instagram: short?.instagram ?? null, website: short?.website ?? null } })
    catalogChanged({})
    if (short?.website && row.brandId) websiteScan = await preScan(row.brandId, short.website, shopper, ipHash)
  }
  return { status: created ? 201 : 200, result: { application: await applicationDto(d, row), websiteScan } }
}

async function preScan(brandId: string, website: string, shopper: ShopperActor, ipHash: string | null): Promise<NonNullable<StudioApplyResult["websiteScan"]>> {
  let url: URL
  try {
    url = cleanUrl(website)
    startUrlOf(url.toString())
  } catch (e) {
    return { status: "skipped", reason: e instanceof ImportUrlError ? e.message : "That address can't be scanned." }
  }
  const perBrand = hit(`catalog.import.scan:${brandId}`, 10, 3600)
  if (!perBrand.ok) return { status: "skipped", reason: "This shop's website was scanned a lot this hour." }
  try {
    const now = new Date()
    const r = await withTx(async () => {
      const d = await db()
      const [x] = await d
        .insert(catalogImports)
        .values({ id: newId("imp"), brandId, sourceUrl: url.toString(), status: "scanning", consentAt: now, progress: { phase: "start" }, createdBy: shopper.userId, createdByName: `${shopper.name} (applicant)`, createdAt: now, updatedAt: now })
        .returning()
      await writeAudit({ actor: { kind: "shopper", id: shopper.userId, name: shopper.name }, action: "catalog.import_scan_started", target: url.hostname, subjectType: "catalog_import", subjectId: x.id, brandId, ipHash, meta: { url: url.toString(), consent: true, applicant: true } })
      return x
    })
    kickImports()
    return { status: "started", importId: r.id }
  } catch (e) {
    log.warn("[yard] studio apply: website pre-scan didn't start", e)
    return { status: "skipped", reason: "The website scan couldn't start. Yard's reviewers will look at it by hand." }
  }
}

/* ---------- App dashboard ---------- */

export async function studioDashboard(actor: BrandActor, days: 7 | 30): Promise<StudioDashboardDto> {
  const d = await db()
  const [nums, overview, unread, pieces] = await Promise.all([
    dashboardNumbers(d, { brandId: actor.brandId, timeZone: actor.brand.timeZone, days }),
    studioOverview(actor.brandId, actor.brand.currency, days),
    canBrand(actor.role, "inbox.read") ? unreadBrand(actor.brandId) : Promise.resolve(null),
    studioPieces(actor).then(
      (p) => p.count,
      () => 0,
    ),
  ])
  return {
    brand: { id: actor.brand.id, handle: actor.brand.handle, name: actor.brand.name, currency: actor.brand.currency, timeZone: actor.brand.timeZone },
    ...nums,
    unreadMessages: unread,
    websitePieces: pieces,
    topProducts: overview.topProducts,
  }
}

/* ---------- Push preferences and the test push ---------- */

export async function getPushPreferences(actor: BrandActor): Promise<StudioPushPreferencesDto> {
  return { push: await pushPrefsOf(await db(), actor.userId, actor.brandId) }
}

export async function setPushPreferences(actor: BrandActor, patch: Partial<PushPrefs>): Promise<StudioPushPreferencesDto> {
  return { push: await withTx(async () => savePushPrefs(await db(), actor.userId, actor.brandId, patch)) }
}

/** POST /api/studio/push/test: one Studio push to the caller's own Studio devices (and the log). */
export async function sendTestPush(actor: BrandActor) {
  if (actor.role === "yard_setup") throw new HttpError(403, "forbidden", "Yard setup sessions have no devices.")
  const out = await sendStudioPush(actor.brandId, [actor.userId], { kind: "studio.test", key: `${actor.userId}:${Date.now()}`, title: "Studio notifications are on", body: `You'll hear about ${actor.brand.name}'s orders and messages here.`, url: "/studio", linkId: null })
  return out
}
