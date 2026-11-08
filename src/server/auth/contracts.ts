import { z } from "zod"
import { ADMIN_ROLES, TEAM_ROLES } from "@/lib/api/contracts/enums"

/**
 * Request bodies for the v3 auth routes (strict: unknown fields are a 400). Plain zod with no
 * server-only import, so the frontend can import these for inline validation, or the
 * orchestrator can move them to src/lib/api/contracts/auth.ts unchanged.
 */
const email = z.string().trim().min(3, "Enter your email address.").max(254, "Keep it to 254 characters.").email("Enter a valid email address.")
const password = z.string().min(1, "Enter your password.").max(200, "Keep it to 200 characters.")
const newPassword = z.string().min(10, "Use at least 10 characters.").max(200, "Keep it to 200 characters.")
const token = z.string().trim().min(40, "This link isn't complete. Open it from the email again.").max(64, "This link isn't valid.").regex(/^[\w-]+$/, "This link isn't valid.")
const name = z.string().trim().min(1, "Enter your name.").max(80, "Keep it to 80 characters.").regex(/^[^\u0000-\u001f\u007f<>]+$/, "Use letters, numbers and simple punctuation.")
const totp = z.string().trim().regex(/^\d{3}\s?\d{3}$/, "Enter the 6-digit code.")
const recovery = z.string().trim().min(10, "Enter a recovery code.").max(20, "Enter a recovery code.")
const id = z.string().min(1).max(64).regex(/^[\w-]+$/)
export const signInActor = z.enum(["shopper", "brand", "admin"])

export const signUpBody = z.object({ name, email, password: newPassword }).strict()
export const signInBody = z.object({ email, password, actor: signInActor.default("shopper"), brandId: id.optional() }).strict()
export const emailOnlyBody = z.object({ email }).strict()
export const tokenBody = z.object({ token }).strict()
export const resetPasswordBody = z.object({ token, password: newPassword }).strict()
export const changePasswordBody = z.object({ currentPassword: password.optional(), newPassword }).strict()

export const mfaChallengeBody = z.object({ challenge: token }).strict()
export const mfaConfirmBody = z.object({ challenge: token, code: totp }).strict()
export const mfaVerifyBody = z
  .object({ challenge: token, code: totp.optional(), recoveryCode: recovery.optional() })
  .strict()
  .refine((b) => !!b.code !== !!b.recoveryCode, { message: "Enter a code from your app or a recovery code.", path: ["code"] })
export const mfaResetBody = z.object({ userId: id, reason: z.string().trim().min(3, "Say why.").max(300) }).strict()

export const reauthBody = z
  .object({ password: password.optional(), code: totp.optional(), recoveryCode: recovery.optional(), demo: z.literal(true).optional() })
  .strict()

export const actorQuery = z.object({ actor: signInActor })
export const asQuery = z.object({ as: z.enum(["shopper", "brand", "admin"]) })

export const oauthStartBody = z
  .object({ mode: z.enum(["signin", "link", "reauth"]).default("signin"), actor: z.enum(["shopper", "brand"]).default("shopper"), brandId: id.optional() })
  .strict()

export const brandSwitchBody = z.object({ brandId: id }).strict()

export const inviteCreateBody = z.object({ email, role: z.enum(TEAM_ROLES) }).strict()
export const inviteAcceptBody = z.object({ token, name: name.optional(), password: newPassword.optional() }).strict()

export const deleteAccountBody = z.object({ confirm: z.literal("DELETE", { message: "Type DELETE to confirm." }) }).strict()

export const adminCreateBody = z.object({ email, name, role: z.enum(ADMIN_ROLES) }).strict()
