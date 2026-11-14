import "server-only"
import { and, eq, gt } from "drizzle-orm"
import { db, withTx } from "../../db"
import { authAppHandoffs } from "../../db/schema/identity"
import { HttpError } from "../../http/errors"
import { assertEligible, deletionPending, openSession, userById, type AnyProfile, type RequestMeta } from "../identity"
import { limitTokenConsume } from "../limits"
import type { ActorKind } from "../session"
import { APP_CODE_RE, APP_VERIFIER_RE, challengeOf, hashHandoffCode } from "./app-core"
import type { ProviderId } from "./providers"

/**
 * POST /api/auth/oauth/app-exchange: a native app trades the hand-off code from
 * yard://auth/complete (plus the verifier only it holds) for a session in its own cookie jar.
 * The session is opened exactly as a browser sign-in opens it (openSession: the same yard_s /
 * yard_b cookie, the same session_auth method). App flows are shopper or brand sign-ins, which
 * never need MFA (that is the Control Center's, and the Control Center has no app sign-in).
 */
export type AppExchangeResult = {
  status: "signed_in"
  /** The callback's result (always "signed_in" for a code that exists). */
  result: string
  /** This sign-in created the Yard account: ask "shop or sell". */
  isNew: boolean
  provider: ProviderId
  actor: ActorKind
  profile: AnyProfile
}

const invalidCode = () => new HttpError(400, "invalid_code", "This sign-in has expired or was already used. Start again.")

export async function exchangeAppHandoff(input: { code: string; verifier: string }, meta: RequestMeta): Promise<AppExchangeResult> {
  await limitTokenConsume("app_exchange", meta.ipHash)
  if (!APP_CODE_RE.test(input.code) || !APP_VERIFIER_RE.test(input.verifier)) throw invalidCode()
  return withTx(async () => {
    const d = await db()
    // One statement claims the code: unknown, used, expired and wrong-verifier codes all match no row.
    // A wrong verifier leaves the code unspent, so an app that sees it leaked can still finish.
    const [h] = await d
      .update(authAppHandoffs)
      .set({ used: true })
      .where(and(eq(authAppHandoffs.codeHash, hashHandoffCode(input.code)), eq(authAppHandoffs.used, false), gt(authAppHandoffs.expiresAt, new Date()), eq(authAppHandoffs.challenge, challengeOf(input.verifier))))
      .returning()
    if (!h) throw invalidCode()
    const user = await userById(h.userId)
    if (!user || user.demo || (await deletionPending(user.id))) throw invalidCode()
    const actor = h.actor as ActorKind
    if (actor === "admin") throw invalidCode()
    const brandId = await assertEligible(actor, user, h.brandId)
    const out = await openSession({ actor, user, brandId, method: h.provider as ProviderId, meta })
    return { status: "signed_in" as const, result: h.result, isNew: h.isNew, provider: h.provider as ProviderId, actor, profile: out.profile }
  })
}
