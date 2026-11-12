import type { NextRequest } from "next/server"
import { z } from "zod"
import { metaOf } from "@/server/auth/http"
import { completeUrl, handleOAuthCallback } from "@/server/auth/oauth/flow"
import { getEnv } from "@/server/env"
import { HttpError } from "@/server/http/errors"
import { route } from "@/server/http/route"
import { log } from "@/server/log"

/**
 * The provider's redirect back to Yard.
 *
 * GET: Google (and Apple's re-entry below). Verifies state + browser binding, exchanges the
 * code, then 302 to /auth/complete?…&result=. Writes are bounded by the single-use state (§2.5).
 *
 * POST: Apple's `response_mode=form_post`. It is a cross-site POST, so the SameSite=Lax binding
 * and session cookies aren't sent: the handler only re-enters as a top-level GET (303) carrying
 * the same parameters, where the cookies are present. No CSRF header check (state protects it).
 */
const param = z.string().max(4096).optional()
const callbackQuery = z.object({ code: param, state: param, error: param, user: param })
const CONTROL = /[\u0000-\u001f\u007f]/

const providerOf = (v: string | undefined) => (v === "apple" ? "apple" : "google")

const inner = route({ auth: "public", query: callbackQuery, rate: { key: "auth.oauth.callback", limit: 30, windowSec: 60, anonGlobal: 1200 } }, async ({ req, query, params, ipHash }) => {
  const provider = providerOf(params.provider)
  if (params.provider !== "google" && params.provider !== "apple") return Response.redirect(completeUrl(provider, "invalid_state"), 302)
  const vals = [query.code, query.state, query.error, query.user]
  if (vals.some((v) => typeof v === "string" && CONTROL.test(v))) return Response.redirect(completeUrl(provider, "invalid_state"), 302)
  const to = await handleOAuthCallback(provider, { code: query.code ?? null, state: query.state ?? null, error: query.error ?? null, appleUser: query.user ?? null }, metaOf(req, ipHash))
  return Response.redirect(to, 302)
})

export async function GET(req: NextRequest, context: { params: Promise<Record<string, string | string[]>> }) {
  const res = await inner(req, context)
  if (res.status === 302) return res
  const p = (await context.params).provider
  log.warn(`[yard] auth: oauth callback refused with ${res.status}; sent to /auth/complete as invalid_state`)
  return Response.redirect(completeUrl(providerOf(typeof p === "string" ? p : undefined), "invalid_state"), 302)
}

const FORM_MAX = 16 * 1024

async function readForm(req: Request) {
  if (!req.body) return new URLSearchParams()
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > FORM_MAX) {
      await reader.cancel().catch(() => {})
      throw new HttpError(413, "too_large", "This request is too large.")
    }
    chunks.push(value)
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"))
}

export const POST = route({ auth: "public", csrf: false }, async ({ req, params }) => {
  const provider = providerOf(params.provider)
  if (params.provider !== "apple") return Response.redirect(completeUrl(provider, "invalid_state"), 303)
  let form: URLSearchParams
  try {
    form = await readForm(req)
  } catch {
    return Response.redirect(completeUrl("apple", "invalid_state"), 303)
  }
  const u = new URL(`/api/auth/oauth/apple/callback`, getEnv().publicUrl)
  for (const k of ["code", "state", "error", "user"]) {
    const v = form.get(k)
    if (v) u.searchParams.set(k, v.slice(0, 4096))
  }
  return Response.redirect(u.toString(), 303)
})
