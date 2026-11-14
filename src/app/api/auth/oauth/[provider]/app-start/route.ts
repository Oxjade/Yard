import { oauthAppStartQuery } from "@/server/auth/contracts"
import { metaOf } from "@/server/auth/http"
import { appCompleteUrl } from "@/server/auth/oauth/app-core"
import { parseProvider, startOAuth } from "@/server/auth/oauth/flow"
import { HttpError } from "@/server/http/errors"
import { route } from "@/server/http/route"
import { log } from "@/server/log"

/**
 * GET /api/auth/oauth/{google|apple|auth0}/app-start?client=android|ios&challenge=<43>&mode=signin&actor=shopper|brand[&connection=]
 *
 * Native app sign-in, opened in a Custom Tab (Google refuses OAuth inside embedded WebViews). The
 * same start as POST …/start (state row, browser-binding cookie on this Custom Tab, PKCE with the
 * provider), but the state remembers the app and its challenge, so the callback ends at
 * yard://auth/complete?code=&result=&provider=&mode=&actor= instead of /auth/complete, and the app
 * exchanges the code at POST /api/auth/oauth/app-exchange. 302 to the provider; a provider without
 * keys → 302 yard://auth/complete?result=not_configured&provider=; any other refusal (rate limit,
 * unknown connection) → 302 yard://auth/complete?result=error&provider=. Bad parameters: 400 JSON.
 */
const redirect = (to: string) => new Response(null, { status: 302, headers: { Location: to } })

export const GET = route({ auth: "public", query: oauthAppStartQuery }, async ({ req, query, params, ipHash }) => {
  const provider = parseProvider(params.provider)
  try {
    const { url } = await startOAuth({ provider, mode: query.mode, actor: query.actor, connection: query.connection ?? null, app: { client: query.client, challenge: query.challenge } }, metaOf(req, ipHash))
    return redirect(url)
  } catch (e) {
    if (e instanceof HttpError && e.code === "not_configured") return redirect(appCompleteUrl({ result: "not_configured", provider }))
    if (!(e instanceof HttpError)) log.error(`[yard] auth: ${provider} app-start failed`, e)
    return redirect(appCompleteUrl({ result: "error", provider }))
  }
})
