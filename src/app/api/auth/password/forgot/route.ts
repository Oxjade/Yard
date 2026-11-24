import { emailRequestBody } from "@/server/auth/contracts"
import { metaOf } from "@/server/auth/http"
import { requestPasswordReset } from "@/server/auth/identity"
import { humanCheck } from "@/server/http/human-check"
import { route } from "@/server/http/route"

/** POST /api/auth/password/forgot { email, turnstileToken?, hp?, formStartedAt? } → { ok: true } whether or not the account exists (and for a bot, which gets no email). */
export const POST = route({ auth: "public", body: emailRequestBody, maxBody: 4 * 1024 }, async ({ req, body, ip, ipHash }) => {
  if ((await humanCheck(req, body, "reset", ip)) === "bot") return { ok: true as const }
  return requestPasswordReset(body.email, metaOf(req, ipHash))
})
