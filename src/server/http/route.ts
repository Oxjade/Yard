import "server-only"
import { randomBytes } from "node:crypto"
import { connection, type NextRequest } from "next/server"
import { z, type ZodType } from "zod"
import { getAdmin, requireActiveBrand, requireAdmin, requireShopper, type Actor, type AdminActor, type BrandActor, type ShopperActor } from "../auth/dal"
import { writeAudit } from "../audit"
import { withBeforeCommit, type BeforeCommit } from "../db"
import { getEnv } from "../env"
import { log } from "../log"
import { dailyHit, hit, recordAbuse } from "../security/rate-limit"
import type { AdminPermission, BrandPermission } from "@/lib/permissions"
import { assertSameOrigin } from "./csrf"
import { badRequest, errorBody, forbidden, HttpError, NotImplemented, rateLimited } from "./errors"
import { pgDataException } from "./pg-errors"
import { clientIp, ipHash as hashIp } from "./request"

/**
 * The one wrapper every v2 Route Handler goes through (§1.10). Options are a discriminated union,
 * so a brand or admin route can't compile without a permission ('any_member'/'any_admin' are
 * explicit sentinels). Order: connection() → getEnv() → CSRF → actor (401) → permission (403)
 * → rate limit → query and body → handler → error mapping → headers.
 */

export type RateOpt = {
  /** The action name, e.g. "inbox.send". The limiter key adds the actor (or IP / global). */
  key: string
  limit: number
  windowSec: number
  /** Durable per-actor daily cap. */
  daily?: number
  /** Per-minute budget shared by every anonymous caller of this action. */
  anonGlobal?: number
}

type Common = {
  /** Default: true for non-GET. 'multipart' for uploads, 'beacon' for sendBeacon text/plain. */
  csrf?: boolean | "multipart" | "beacon"
  rate?: RateOpt
  query?: ZodType
  body?: ZodType
  /**
   * Largest JSON body in bytes (default 64 KB whenever `body` is set). A bigger Content-Length is
   * refused with 413 before anything is read, and a chunked body is cut off at the cap. Uploads
   * (csrf: 'multipart', no `body`) read the request themselves with their own caps (§5.4).
   */
  maxBody?: number
  cache?: "no-store" | { public: number; swr?: number }
}

export type RouteOpts =
  | ({ auth: "public" } & Common)
  | ({ auth: "shopper"; notRestricted?: "messaging" | "uploads" | "reports" } & Common)
  | ({ auth: "brand"; permission: BrandPermission | "any_member" } & Common)
  | ({ auth: "admin"; permission: AdminPermission | "any_admin" } & Common)
  | ({ auth: "multi"; as: ("shopper" | "brand" | "admin")[]; permission?: { brand?: BrandPermission | "any_member"; admin?: AdminPermission | "any_admin" } } & Common)

type ActorOf<O> = O extends { auth: "public" }
  ? null
  : O extends { auth: "shopper" }
    ? ShopperActor
    : O extends { auth: "brand" }
      ? BrandActor
      : O extends { auth: "admin" }
        ? AdminActor
        : Actor
type QueryOf<O> = O extends { query: infer Q extends ZodType } ? z.output<Q> : Record<string, string>
type BodyOf<O> = O extends { body: infer B extends ZodType } ? z.output<B> : undefined

export type RouteContext<O> = {
  req: NextRequest
  actor: ActorOf<O>
  query: QueryOf<O>
  body: BodyOf<O>
  params: Record<string, string>
  /** The client IP under the trust model (§5.1), or null when unknown. */
  ip: string | null
  ipHash: string | null
  requestId: string
}

type Handler<O> = (ctx: RouteContext<O>) => Promise<Response | unknown> | Response | unknown

/** JSON with a status (201 and friends). Plain objects returned from a handler are 200. */
export function json(data: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(data, { status, headers })
}

/** 204 No Content. */
export const noContent = () => new Response(null, { status: 204 })

/** zod's own messages aren't for people (§1.10): map them to plain sentences, keep authored ones. */
function friendly(issue: z.core.$ZodIssue): string {
  const authored = issue.message && !/^(Invalid|Too (small|big)|Unrecognized|Expected|Required|Input not instance)/.test(issue.message)
  if (authored) return issue.message
  switch (issue.code) {
    case "invalid_type":
      return issue.input === undefined ? "This is required." : "This value isn't valid."
    case "too_small":
      return issue.origin === "string" ? (Number(issue.minimum) <= 1 ? "This is required." : `Use at least ${issue.minimum} characters.`) : issue.origin === "array" ? `Choose at least ${issue.minimum}.` : `Use ${issue.minimum} or more.`
    case "too_big":
      return issue.origin === "string" ? `Keep it to ${issue.maximum} characters.` : issue.origin === "array" ? `Choose at most ${issue.maximum}.` : `Use ${issue.maximum} or less.`
    case "invalid_value":
      return "Choose one of the options."
    case "unrecognized_keys":
      return "This field isn't allowed."
    case "invalid_format":
      return "This isn't in the right format."
    default:
      return "This value isn't valid."
  }
}

export function zodFields(error: z.ZodError) {
  const fields: Record<string, string> = {}
  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const k of issue.keys) fields[[...issue.path, k].join(".")] ??= "This field isn't allowed."
      continue
    }
    fields[issue.path.join(".") || "_"] ??= friendly(issue)
  }
  return fields
}

export const DEFAULT_MAX_BODY = 64 * 1024

const tooLarge = (max: number) => new HttpError(413, "too_large", `This request is too large. Keep it under ${Math.round(max / 1024)} KB.`)

/** Refuses a declared Content-Length over the cap before anything is read. */
function assertDeclaredSize(req: Request, max: number) {
  const declared = req.headers.get("content-length")
  if (declared != null && /^\d+$/.test(declared.trim()) && Number(declared) > max) throw tooLarge(max)
}

/** Reads the body as text, counting bytes as they arrive and cancelling past the cap (chunked bodies too). */
async function readCapped(req: Request, max: number) {
  if (!req.body) return ""
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel().catch(() => {})
      throw tooLarge(max)
    }
    chunks.push(value)
  }
  const all = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    all.set(c, at)
    at += c.byteLength
  }
  return new TextDecoder().decode(all)
}

async function readJson(req: Request, max: number) {
  const text = await readCapped(req, max)
  if (!text.trim()) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw badRequest({ _: "Send a JSON body." }, "The request body isn't valid JSON.")
  }
}

/** Whether a query field's schema takes several values (z.array, possibly optional/defaulted). */
function takesArray(schema: ZodType | undefined, key: string): boolean {
  const shape = (schema as unknown as { shape?: Record<string, ZodType> } | undefined)?.shape
  let s: unknown = shape?.[key]
  for (let i = 0; i < 8 && s; i++) {
    const def = (s as { _zod?: { def?: { type?: string; innerType?: unknown; in?: unknown } } })._zod?.def
    if (!def) return false
    if (def.type === "array") return true
    if (def.type === "pipe") s = def.in
    else if (def.innerType) s = def.innerType
    else return false
  }
  return false
}

/**
 * The query as a record. A key sent twice is refused (400), unless its schema field is an array:
 * otherwise the actor could be resolved from one value of `as` while the handler saw another.
 */
function readQuery(url: URL, schema: ZodType | undefined) {
  const out: Record<string, string | string[]> = {}
  const repeated: Record<string, string> = {}
  for (const key of new Set(url.searchParams.keys())) {
    const all = url.searchParams.getAll(key)
    if (takesArray(schema, key)) out[key] = all
    else if (all.length > 1) repeated[key] = `Send ${key}= once.`
    else out[key] = all[0]
  }
  if (Object.keys(repeated).length) throw badRequest(repeated, "A query parameter was sent more than once.")
  return out
}

async function resolveActor(opts: RouteOpts, asParam: string | null): Promise<Actor | null> {
  switch (opts.auth) {
    case "public":
      return null
    case "shopper":
      return requireShopper({ notRestricted: opts.notRestricted })
    case "brand":
      return requireActiveBrand(opts.permission, { allowYardSetup: true })
    case "admin":
      return requireAdmin(opts.permission)
    case "multi": {
      const as = asParam as "shopper" | "brand" | "admin" | null
      if (!as || !opts.as.includes(as)) throw badRequest({ as: `Use as=${opts.as.join(" or as=")}.` })
      if (as === "shopper") return requireShopper()
      if (as === "brand") return requireActiveBrand(opts.permission?.brand ?? "any_member", { allowYardSetup: true })
      return requireAdmin(opts.permission?.admin ?? "any_admin")
    }
  }
}

/**
 * Yard setup (founding brands): Yard staff working in an unclaimed brand reach only these API
 * areas. Deny by default: payouts, payout account, orders, inbox, social, locations, drops,
 * invites, brand switch, realtime, notifications and every other path answer 403. A new Studio
 * area must be added here on purpose.
 */
const YARD_SETUP_PATHS = [/^\/api\/studio\/catalog(\/|$)/, /^\/api\/studio\/storefront(\/|$)/, /^\/api\/studio\/shipping$/, /^\/api\/studio\/setup$/, /^\/api\/uploads$/, /^\/api\/media(\/|$)/]
// Dev-only helpers under these prefixes stay closed to Yard setup.
const YARD_SETUP_DENY = [/\/dev(\/|$)/]

export function yardSetupMayUse(pathname: string) {
  return YARD_SETUP_PATHS.some((r) => r.test(pathname)) && !YARD_SETUP_DENY.some((r) => r.test(pathname))
}

const actorKey = (a: Actor | null, ipHash: string | null) => (a ? `${a.kind}:${a.userId}` : ipHash ? `ip:${ipHash}` : "anon")

async function applyRate(rate: RateOpt, actor: Actor | null, ipHash: string | null) {
  const who = actorKey(actor, ipHash)
  // Anonymous with no known IP (§5.1): there is no per-caller key to count against, so only the
  // action's global anonymous bucket applies (never one shared per-caller budget for everyone).
  const checks: { key: string; limit: number }[] = actor || ipHash ? [{ key: `${rate.key}:${who}`, limit: rate.limit }] : []
  if (!actor && rate.anonGlobal) checks.push({ key: `${rate.key}:anon-global`, limit: rate.anonGlobal })
  for (const c of checks) {
    const r = hit(c.key, c.limit, rate.windowSec)
    if (!r.ok) {
      await recordAbuse(c.key, { kind: actor?.kind ?? "anon", id: actor?.userId ?? null, ipHash }, rate.key, "rate_limit", { limit: c.limit, windowSec: rate.windowSec }).catch(() => {})
      throw rateLimited(r.retryAfter)
    }
  }
  if (rate.daily && actor) {
    const r = await dailyHit(`${rate.key}:day:${who}`, rate.daily)
    if (!r.ok) {
      await recordAbuse(`${rate.key}:day:${who}`, { kind: actor.kind, id: actor.userId, ipHash }, rate.key, "daily_cap", { limit: rate.daily }).catch(() => {})
      throw rateLimited(r.retryAfter, "You've reached today's limit for this. Try again tomorrow.")
    }
  }
}

function finish(res: Response, opts: RouteOpts, requestId: string) {
  try {
    if (!res.headers.has("Cache-Control")) {
      const c = opts.cache ?? "no-store"
      res.headers.set("Cache-Control", c === "no-store" ? "no-store" : `public, max-age=${c.public}${c.swr ? `, stale-while-revalidate=${c.swr}` : ""}`)
    }
    res.headers.set("X-Content-Type-Options", "nosniff")
    res.headers.set("X-Request-Id", requestId)
  } catch {
    /* immutable headers (a proxied Response): leave them */
  }
  return res
}

function errorResponse(e: unknown, requestId: string): Response {
  if (e instanceof HttpError) {
    const headers: Record<string, string> = {}
    if (e.retryAfter) headers["Retry-After"] = String(e.retryAfter)
    return Response.json(errorBody(e), { status: e.status, headers })
  }
  if (e instanceof z.ZodError) return Response.json(errorBody(badRequest(zodFields(e))), { status: 400 })
  if (e instanceof NotImplemented) {
    log.once(`notimpl:${e.fn}`, "warn", `[yard] ${e.fn} called before its cluster implemented it (request ${requestId})`)
    return Response.json({ error: { code: "not_configured", message: "This part of Yard isn't switched on yet." } }, { status: 503 })
  }
  // A backstop for values Postgres refuses as a data exception (SQLSTATE class 22, pg-errors.ts): a
  // NUL (22021, 22P05), a date that doesn't exist (22007, 22008), text where a number or uuid belongs
  // (22P02), a number out of range (22003), text too long (22001). Contracts should already refuse
  // these, but if one slips through it's the caller's input, so a 400, never a 500 that logs the
  // statement. The warning (once per code) names the missing contract rule, in fixed words.
  const data = pgDataException(e)
  if (data) {
    log.once(`pg-data:${data.code}`, "warn", `[yard] request ${requestId}: Postgres refused a value (${data.code} ${data.name}); a contract is missing ${data.text ? "safeText()/safeId()" : "a rule for this field"}`)
    return Response.json({ error: { code: "validation", message: data.message } }, { status: 400 })
  }
  log.error(`[yard] request ${requestId} failed`, e)
  return Response.json({ error: { code: "internal", message: "Something went wrong on our side. Try again." } }, { status: 500 })
}

export function route<const O extends RouteOpts>(opts: O, handler: Handler<O>) {
  return async function handle(req: NextRequest, context?: { params?: Promise<Record<string, string | string[]>> }): Promise<Response> {
    const requestId = randomBytes(6).toString("hex")
    // 1. Request time only: nothing here may be prerendered (§1.6 rule 3).
    await connection()
    try {
      // 2. Configuration (lazy; throws in production without secrets).
      getEnv()
      // 3. CSRF for anything that isn't a read.
      const method = req.method.toUpperCase()
      const csrf = opts.csrf ?? (method !== "GET" && method !== "HEAD")
      if (csrf) assertSameOrigin(req, { body: csrf === "multipart" ? "multipart" : csrf === "beacon" ? "beacon" : opts.body ? "json" : "none" })
      // An oversized JSON body is refused before anything else reads it.
      const maxBody = opts.maxBody ?? (opts.body ? DEFAULT_MAX_BODY : undefined)
      if (maxBody !== undefined) assertDeclaredSize(req, maxBody)
      const url = new URL(req.url)
      const rawQuery = readQuery(url, opts.query)
      // 4–5. Actor and permission (401 / 403), through the DAL.
      const asParam = typeof rawQuery.as === "string" ? rawQuery.as : null
      const actor = await resolveActor(opts, asParam)
      const yardSetup = actor?.kind === "brand" && actor.role === "yard_setup" ? actor : null
      if (yardSetup && !yardSetupMayUse(url.pathname)) throw forbidden("Yard setup covers products, photos, collections, storefront and shipping only.")
      const ip = clientIp(req)
      const ipHash = hashIp(ip)
      // 6. Rate limit.
      if (opts.rate) await applyRate(opts.rate, actor, ipHash)
      // 7. Query and body.
      const parsed = (opts.query ? opts.query.parse(rawQuery) : rawQuery) as Record<string, unknown>
      // A multi-actor handler only ever sees the kind that was authenticated (§1.10).
      const query = opts.auth === "multi" && actor && parsed && typeof parsed === "object" ? { ...parsed, as: actor.kind } : parsed
      const body = opts.body ? opts.body.parse((await readJson(req, maxBody ?? DEFAULT_MAX_BODY)) ?? {}) : undefined
      const raw = (await context?.params) ?? {}
      const params = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v.join("/") : v]))
      // 8. The handler.
      const run = async () => handler({ req, actor: actor as ActorOf<O>, query: query as QueryOf<O>, body: body as BodyOf<O>, params, ip, ipHash, requestId })
      // Every Yard setup write leaves an admin-attributed row (writeAudit maps the role), written
      // inside the handler's first transaction, so the write and its audit commit together or not at all.
      const setupWrite = yardSetup && method !== "GET" && method !== "HEAD" ? yardSetup : null
      const auditSetup = setupWrite
        ? (extra: Record<string, unknown>) =>
            writeAudit({ actor: { kind: "brand", id: setupWrite.userId, name: setupWrite.name, role: "yard_setup" }, action: "yard_setup.write", target: `${method} ${url.pathname}`, subjectType: "brand", subjectId: setupWrite.brandId, brandId: setupWrite.brandId, ipHash, meta: { requestId, ...extra } })
        : null
      const hook: BeforeCommit | null = auditSetup ? { run: async () => void (await auditSetup({ inTransaction: true })), ran: 0 } : null
      const out = hook ? await withBeforeCommit(hook, run) : await run()
      const res = out instanceof Response ? out : Response.json(out ?? { ok: true })
      // A write that opened no transaction: audit it now, and fail the request if that can't be recorded.
      if (auditSetup && hook && !hook.ran && res.status < 400) await auditSetup({ status: res.status, inTransaction: false })
      return finish(res, opts, requestId)
    } catch (e) {
      return finish(errorResponse(e, requestId), { ...opts, cache: "no-store" }, requestId)
    }
  }
}

/** For handlers that need the admin without failing (e.g. dev endpoints answering 404 first). */
export { getAdmin }
