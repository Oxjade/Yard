package space.yardstore.app.features.auth

import kotlinx.serialization.Serializable

// Auth request/response shapes (src/server/auth/contracts.ts — every body schema is `.strict()`,
// so these classes carry exactly the keys the server accepts; null properties are omitted because
// YardJson has `explicitNulls = false`). Mirrors Features/Auth/AuthModels.swift.

// region Providers

/**
 * GET /api/auth/providers →
 * `{ password, magicLink, google, apple, auth0, auth0Connections: [{ name, label }], demo: { shopper, brand, admin } }`.
 * google/apple/auth0 are false when the server has no keys for them: hide those buttons.
 */
@Serializable
data class AuthProviders(
    val google: Boolean = false,
    val apple: Boolean = false,
    val auth0: Boolean = false,
    val auth0Connections: List<Connection> = emptyList(),
    val magicLink: Boolean = true,
    val demo: Demo? = null,
) {
    @Serializable
    data class Connection(val name: String = "", val label: String = "")

    @Serializable
    data class Demo(val shopper: Boolean? = null)

    /** The server allows the shared demo shopper sign-in. */
    val demoShopper: Boolean get() = demo?.shopper ?: false

    companion object {
        /** Previews: the site's default (Google via Auth0). */
        fun preview(demoShopper: Boolean = false) = AuthProviders(
            auth0 = true,
            auth0Connections = listOf(Connection(name = "google-oauth2", label = "Google")),
            magicLink = true,
            demo = Demo(shopper = demoShopper),
        )
    }
}

/**
 * One "Continue with …" button (mirrors `socialButtons` in src/lib/auth/auth0.ts):
 * direct Google / Apple first, then one per Auth0 connection, without duplicates.
 */
data class AuthSocialButton(
    /** "google", "apple" or "auth0:<connection>". */
    val key: String,
    /** Path segment for /api/auth/oauth/{provider}/start: "google" | "apple" | "auth0". */
    val provider: String,
    /** Auth0 connection ("google-oauth2"), null for direct providers. */
    val connection: String?,
    /** "Google", "Apple", "Facebook"… */
    val label: String,
    val mark: Mark,
) {
    enum class Mark { Google, Apple, Generic }

    val id: String get() = key

    companion object {
        /** The Auth0 Google button, used when the providers list can't be read (the site's default connection). */
        val auth0Google = AuthSocialButton(key = "auth0:google-oauth2", provider = "auth0", connection = "google-oauth2", label = "Google", mark = Mark.Google)

        fun buttons(from: AuthProviders?): List<AuthSocialButton> {
            val p = from ?: return emptyList()
            val out = mutableListOf<AuthSocialButton>()
            if (p.google) out += AuthSocialButton("google", "google", null, "Google", Mark.Google)
            if (p.apple) out += AuthSocialButton("apple", "apple", null, "Apple", Mark.Apple)
            if (p.auth0) {
                for (c in p.auth0Connections) {
                    if (c.name == "google-oauth2" && p.google) continue
                    if (c.name == "apple" && p.apple) continue
                    val mark = when (c.name) {
                        "google-oauth2" -> Mark.Google
                        "apple" -> Mark.Apple
                        else -> Mark.Generic
                    }
                    out += AuthSocialButton("auth0:${c.name}", "auth0", c.name, c.label.ifEmpty { c.name }, mark)
                }
            }
            return out
        }
    }
}

// endregion

// region Bodies

/** POST /api/auth/sign-in. */
@Serializable
data class AuthSignInBody(val email: String, val password: String, val actor: String)

/** POST /api/auth/sign-up. */
@Serializable
data class AuthSignUpBody(val name: String, val email: String, val password: String)

/** POST /api/auth/magic-link, /api/auth/password/forgot, /api/auth/verify-email/request. */
@Serializable
data class AuthEmailBody(val email: String)

/** POST /api/auth/magic-link/consume, /api/auth/verify-email/confirm. */
@Serializable
data class AuthTokenBody(val token: String)

/** POST /api/auth/oauth/app-exchange: the hand-off code from yard://auth/complete and its PKCE verifier. */
@Serializable
data class AuthAppExchangeBody(val code: String, val verifier: String)

/** POST /api/auth/demo. */
@Serializable
data class AuthDemoBody(val actor: String, val account: String)

// endregion

// region Responses

/**
 * Sign-in / magic-link consume / verify-email confirm:
 * `{ status: "signed_in" | "verify_email" | "verified" | "mfa_required" …, signedIn? }`.
 */
@Serializable
data class AuthStatusResponse(val status: String = "", val signedIn: Boolean? = null)

/**
 * POST /api/auth/oauth/app-exchange → `{ result: "signed_in", isNew, … }` (session cookie set), or the
 * password sign-in's MFA shape `{ status: "mfa_required" | "mfa_enrol_required", … }`. The app
 * ignores any session fields here and re-reads GET /api/session afterwards.
 */
@Serializable
data class AuthAppExchangeResponse(
    val result: String = "",
    val isNew: Boolean = false,
    val status: String? = null,
) {
    val isMfaRequired: Boolean get() = status?.startsWith("mfa_") == true
}

// endregion

/** `result=` on /auth/complete and yard://auth/complete → the website's wording (auth-oauth-completion.tsx). */
object AuthOAuthResult {
    fun message(result: String): String = when (result) {
        "cancelled" -> "Sign-in was cancelled."
        "invalid_state" -> "This sign-in link expired or could not be verified. Start again."
        "error" -> "The provider couldn’t complete sign-in. Try again."
        "not_configured" -> "This sign-in provider isn’t configured on Yard yet."
        "identity_in_use" -> "That provider account is connected to another Yard account."
        "already_linked" -> "That provider is already connected to this account."
        "link_required" -> "Sign in with your password before connecting this provider."
        "email_required" -> "The provider didn’t share an email address. Try another sign-in method."
        "email_unverified" -> "That account’s email address isn’t verified with the provider. Verify it there, or sign in another way."
        "no_brand" -> "This account doesn’t have a brand workspace yet. Apply to sell on Yard to open one, or sign in with the account your brand uses."
        "suspended" -> "This account is currently unavailable."
        "reauth_mismatch" -> "The provider account didn’t match the account being confirmed."
        else -> "Sign-in could not be completed."
    }
}
