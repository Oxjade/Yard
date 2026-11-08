import { signUpBody } from "@/server/auth/contracts"
import { metaOf } from "@/server/auth/http"
import { signUp } from "@/server/auth/identity"
import { route } from "@/server/http/route"

/**
 * POST /api/auth/sign-up { name, email, password } → { status: "verify_email" }.
 * Always the same answer (no account enumeration). The verification link signs the shopper in.
 */
export const POST = route({ auth: "public", body: signUpBody, maxBody: 4 * 1024 }, async ({ req, body, ipHash }) => signUp(body, metaOf(req, ipHash)))
