import { signInBody } from "@/server/auth/contracts"
import { metaOf } from "@/server/auth/http"
import { signInWithPassword } from "@/server/auth/identity"
import { route } from "@/server/http/route"

/**
 * POST /api/auth/sign-in { email, password, actor = shopper | brand | admin, brandId? }
 *  → { status: "signed_in", actor, profile }            (cookie set)
 *  | { status: "verify_email" }                          (a new verification email was sent)
 *  | { status: "mfa_required" | "mfa_enrol_required", challenge, expiresAt }   (admins; then /api/auth/mfa/*)
 * Wrong email or password: 401 "That email and password don't match." Too many attempts: 429.
 */
export const POST = route({ auth: "public", body: signInBody, maxBody: 4 * 1024 }, async ({ req, body, ipHash }) => signInWithPassword(body, metaOf(req, ipHash)))
