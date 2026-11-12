import "server-only"
import { after, type NextRequest } from "next/server"
import { z } from "zod"
import { CONNECT_RESULTS, startQuery } from "@/lib/api/contracts/social"
import { getBrandActor } from "../auth/dal"
import { getEnv } from "../env"
import { log } from "../log"
import { badRequest, HttpError, notFound, rateLimited } from "../http/errors"
import { json, route } from "../http/route"
import { hit, recordAbuse } from "../security/rate-limit"
import { dataDeletion, deauthorize, verifySignedRequest } from "./meta"
import type { ProviderId } from "./providers"
import { completeConnect, startConnect } from "./service"
import { syncAccount } from "./sync"

/**
 * Route factories shared by /api/social/instagram/* and /api/social/tiktok/* (the provider is a
 * static segment, so the Meta-only callbacks can sit beside start and callback).
 */

/** POST /api/social/{provider}/start (§5.5): creates the state and returns { url }. GET is 405. */
export function startRoute(provider: ProviderId) {
  return route({ auth: "brand", permission: "social.connect", query: startQuery }, async ({ actor, query, ipHash }) => startConnect(actor, provider, query.mode === "sandbox", ipHash))
}

/**
 * The keys a provider sends back. Each is declared as an array, so a key repeated by a provider or
 * a proxy reaches the handler instead of route()'s 400; a value that differs between repeats is
 * treated as a failed connection.
 */
const many = z.array(z.string().max(4096)).optional()
const callbackQuery = z.object({ code: many, state: many, error: many, error_reason: many, error_description: many, error_code: many, error_message: many, scopes: many, scope: many })

/** The single value of a repeated key, or null when it's absent or the repeats disagree. */
function one(v: string[] | undefined): string | null | false {
  if (!v?.length) return null
  return v.every((x) => x === v[0]) ? v[0] : false
}

const CONTROL = /[\u0000-\u001F\u007F]/

const toStudio = (result: string, provider: ProviderId) =>
  new Response(null, { status: 302, headers: { Location: `/studio/social?tab=connections&result=${result}&provider=${provider}`, "Cache-Control": "no-store" } })

/**
 * GET /api/social/{provider}/callback: verifies state (and PKCE), exchanges the code outside any
 * transaction, upserts the account and its sealed tokens, kicks off a sync with after(), then
 * 302s to /studio/social?tab=connections&result=…. There is no return_to: nothing to redirect
 * anywhere else. Any failure lands on result=invalid_state (or denied / error).
 */
export function callbackRoute(provider: ProviderId) {
  const inner = route({ auth: "public", query: callbackQuery, rate: { key: "social.callback", limit: 30, windowSec: 60, anonGlobal: 600 } }, async ({ query, ipHash }) => {
    const code = one(query.code)
    const state = one(query.state)
    const error = one(query.error)
    // Disagreeing repeats, or a value with control characters, never reach the state check or the provider.
    if (code === false || state === false || error === false || [code, state, error].some((v) => typeof v === "string" && CONTROL.test(v))) return toStudio("invalid_state", provider)
    let out: Awaited<ReturnType<typeof completeConnect>>
    try {
      const session = await getBrandActor()
      out = await completeConnect({ provider, code, error, state, session, ipHash })
    } catch (e) {
      log.error(`[yard] social: ${provider} callback failed`, e)
      out = { result: "error" }
    }
    if (out.result === "connected" && out.accountId) {
      const id = out.accountId
      after(() => syncAccount(id, { trigger: "connect" }).then(() => undefined))
    }
    const result = (CONNECT_RESULTS as readonly string[]).includes(out.result) ? out.result : "error"
    return toStudio(result, provider)
  })
  // Whatever route() refuses before the handler runs (a repeated key it doesn't know, say), the
  // person is in the middle of a provider round trip: send them back to Studio, never to raw JSON.
  return async function handle(req: NextRequest, context?: { params?: Promise<Record<string, string | string[]>> }) {
    const res = await inner(req, context)
    if (res.status === 302) return res
    log.warn(`[yard] social: ${provider} callback refused with ${res.status}; sent back to Studio as invalid_state`)
    return toStudio("invalid_state", provider)
  }
}

const META_MAX = 8 * 1024

/** Reads a small form body (Meta posts application/x-www-form-urlencoded), cut off past the cap. */
async function readForm(req: Request) {
  if (!req.body) return new URLSearchParams()
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > META_MAX) {
      await reader.cancel().catch(() => {})
      throw new HttpError(413, "too_large", "This request is too large.")
    }
    chunks.push(value)
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"))
}

const META_PER_IP = 60
const META_GLOBAL = 120

/** 60/min per IP and 120/min overall (§5.1); going over writes an abuse_events row. */
async function metaRate(ipHash: string | null) {
  const checks = [...(ipHash ? [{ key: `social.meta:ip:${ipHash}`, limit: META_PER_IP }] : []), { key: "social.meta:anon-global", limit: META_GLOBAL }]
  for (const c of checks) {
    const r = hit(c.key, c.limit, 60)
    if (!r.ok) {
      await recordAbuse(c.key, { kind: "anon", id: null, ipHash }, "social.meta", "rate_limit", { limit: c.limit, windowSec: 60 }).catch(() => {})
      throw rateLimited(r.retryAfter)
    }
  }
}

/**
 * POST /api/social/instagram/{deauthorize,data-deletion} (server to server; no CSRF header).
 * 404 unless Instagram is configured, before anything else: no body cap, rate limit or abuse row
 * runs first, so with no secret (the default) these endpoints don't exist and nobody can forge a
 * request with an empty key. Then 60/min per IP, 120/min overall, and an 8 KB body.
 */
export function metaRoute(kind: "deauthorize" | "data-deletion") {
  return route({ auth: "public", csrf: false }, async ({ req, ipHash }) => {
    const ig = getEnv().instagram
    if (!ig.configured || !ig.appSecret) throw notFound()
    await metaRate(ipHash)
    const declared = req.headers.get("content-length")
    if (declared && /^\d+$/.test(declared.trim()) && Number(declared) > META_MAX) throw new HttpError(413, "too_large", "This request is too large.")
    const form = await readForm(req)
    const payload = verifySignedRequest(form.get("signed_request") ?? "", ig.appSecret)
    if (!payload?.user_id) throw badRequest({ signed_request: "The signed request isn't valid." })
    if (kind === "deauthorize") {
      await deauthorize(payload.user_id)
      return json({ ok: true })
    }
    return json(await dataDeletion(payload.user_id))
  })
}
