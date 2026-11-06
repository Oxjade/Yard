import "server-only"
import { after } from "next/server"
import { CONNECT_RESULTS, startQuery } from "@/lib/api/contracts/social"
import { getBrandActor } from "../auth/dal"
import { getEnv } from "../env"
import { log } from "../log"
import { badRequest, notFound } from "../http/errors"
import { json, route } from "../http/route"
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
  return route({ auth: "brand", permission: "social.connect", query: startQuery }, async ({ actor, query }) => startConnect(actor, provider, query.mode === "sandbox"))
}

/**
 * GET /api/social/{provider}/callback: verifies state (and PKCE), exchanges the code outside any
 * transaction, upserts the account and its sealed tokens, kicks off a sync with after(), then
 * 302s to /studio/social?tab=connections&result=…. There is no return_to: nothing to redirect
 * anywhere else. Any failure lands on result=invalid_state (or denied / error).
 */
export function callbackRoute(provider: ProviderId) {
  return route({ auth: "public" }, async ({ query, ipHash }) => {
    const q = query as Record<string, string | undefined>
    let out: Awaited<ReturnType<typeof completeConnect>>
    try {
      const session = await getBrandActor()
      out = await completeConnect({ provider, code: q.code ?? null, error: q.error ?? null, state: q.state ?? null, session, ipHash })
    } catch (e) {
      log.error(`[yard] social: ${provider} callback failed`, e)
      out = { result: "error" }
    }
    if (out.result === "connected" && out.accountId) {
      const id = out.accountId
      after(() => syncAccount(id, { trigger: "connect" }).then(() => undefined))
    }
    const result = (CONNECT_RESULTS as readonly string[]).includes(out.result) ? out.result : "error"
    return new Response(null, { status: 302, headers: { Location: `/studio/social?tab=connections&result=${result}&provider=${provider}`, "Cache-Control": "no-store" } })
  })
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
      throw badRequest({ signed_request: "This request is too large." })
    }
    chunks.push(value)
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"))
}

/**
 * POST /api/social/instagram/{deauthorize,data-deletion} (server to server; no CSRF header).
 * 404 unless Instagram is configured, so with no secret (the default) nothing can be signed and
 * nobody can forge one with an empty key. 60/min per IP, 120/min overall.
 */
export function metaRoute(kind: "deauthorize" | "data-deletion") {
  return route({ auth: "public", csrf: false, maxBody: META_MAX, rate: { key: "social.meta", limit: 60, windowSec: 60, anonGlobal: 120 } }, async ({ req }) => {
    const ig = getEnv().instagram
    if (!ig.configured || !ig.appSecret) throw notFound()
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
