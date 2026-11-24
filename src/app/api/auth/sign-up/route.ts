import { signUpBody } from "@/server/auth/contracts"
import { metaOf } from "@/server/auth/http"
import { signUp } from "@/server/auth/identity"
import { humanCheck, splitHuman } from "@/server/http/human-check"
import { route } from "@/server/http/route"

/**
 * POST /api/auth/sign-up { name, email, password, turnstileToken?, hp?, formStartedAt? } → { status: "verify_email" }.
 * Always the same answer (no account enumeration). The verification link signs the shopper in.
 * A throwaway or test address is refused (400 on `email`); a bot (server/http/human-check.ts) gets
 * the same answer as everyone and nothing is created.
 */
export const POST = route({ auth: "public", body: signUpBody, maxBody: 4 * 1024 }, async ({ req, body, ip, ipHash, bodySha256 }) => {
  const { human, rest } = splitHuman(body)
  if ((await humanCheck(req, human, "signup", ip, bodySha256)) === "bot") return { status: "verify_email" as const }
  return signUp(rest, metaOf(req, ipHash))
})
