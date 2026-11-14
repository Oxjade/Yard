package space.yardstore.app.features.auth

import android.net.Uri
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.Config
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.core.networking.HTTPMethod
import space.yardstore.app.core.stores.SessionStore
import kotlin.coroutines.cancellation.CancellationException

/**
 * The auth endpoints the app uses (src/app/api/auth/…). Every call goes through `APIClient.shared`,
 * so the session cookie (`yard_s` / `__Host-yard_s`) lands in the app's `PersistentCookieJar`.
 * Mirrors `AuthAPI` in AuthService.swift.
 */
object AuthAPI {
    /** Tests only: a client and an absolute base URL (MockWebServer) instead of the app's. */
    internal var clientOverride: APIClient? = null
    internal var baseOverride: String? = null

    private val api: APIClient get() = clientOverride ?: APIClient.shared
    private fun p(path: String): String = baseOverride?.let { it.trimEnd('/') + path } ?: path

    /** GET /api/auth/providers. */
    suspend fun providers(): AuthProviders = api.get(p("/api/auth/providers"))

    /**
     * POST /api/auth/sign-in → `signed_in` (cookie set) | `verify_email` | `mfa_*` (admins only).
     * Wrong email or password: 401 with the server's sentence.
     */
    suspend fun signIn(email: String, password: String): AuthStatusResponse =
        api.post(p("/api/auth/sign-in"), body = AuthSignInBody(email = email, password = password, actor = "shopper"))

    /** POST /api/auth/sign-up → always `{ status: "verify_email" }` (no account enumeration). */
    suspend fun signUp(name: String, email: String, password: String) {
        api.send(HTTPMethod.POST, p("/api/auth/sign-up"), body = AuthSignUpBody(name = name, email = email, password = password))
    }

    /** POST /api/auth/magic-link → `{ ok: true }` (a 15-minute sign-in link by email). */
    suspend fun requestMagicLink(email: String) {
        api.send(HTTPMethod.POST, p("/api/auth/magic-link"), body = AuthEmailBody(email))
    }

    /** POST /api/auth/password/forgot → `{ ok: true }` whether or not the account exists. */
    suspend fun requestPasswordReset(email: String) {
        api.send(HTTPMethod.POST, p("/api/auth/password/forgot"), body = AuthEmailBody(email))
    }

    /**
     * POST /api/auth/oauth/app-exchange { code, verifier }: swaps the single-use code from
     * `yard://auth/complete` for the session cookie (`yard_s`), set in the app's own cookie jar.
     * 400 `invalid_code` when the code is unknown, used, expired or the verifier doesn't match.
     */
    suspend fun exchangeAppCode(code: String, verifier: String): AuthAppExchangeResponse =
        api.post(p("/api/auth/oauth/app-exchange"), body = AuthAppExchangeBody(code = code, verifier = verifier))

    /** POST /api/auth/demo { actor: "shopper", account: "u_ada" } (only when providers.demo.shopper). */
    suspend fun signInDemo() {
        api.send(HTTPMethod.POST, p("/api/auth/demo"), body = AuthDemoBody(actor = "shopper", account = "u_ada"))
    }

    /** POST /api/auth/magic-link/consume { token } → `{ status: "signed_in" }`. */
    suspend fun consumeMagicLink(token: String): AuthStatusResponse =
        api.post(p("/api/auth/magic-link/consume"), body = AuthTokenBody(token))

    /** POST /api/auth/verify-email/confirm { token } → `{ status: "verified", signedIn }`. */
    suspend fun confirmEmail(token: String): AuthStatusResponse =
        api.post(p("/api/auth/verify-email/confirm"), body = AuthTokenBody(token))
}

/**
 * Email links (`/auth/magic?token=…`, `/auth/verify?token=…`) opened in the app.
 *
 * Not wired yet: `MainActivity.handleLink` (foundation) hands every link to `router.open`, which
 * doesn't know `/auth/…` links. To finish sign-in in the app, call this first:
 *
 *   if (AuthEmailLinks.canHandle(url)) {
 *       scope.launch { AuthEmailLinks.handle(url, session)?.let { toast.show(it) } }
 *       return
 *   }
 */
object AuthEmailLinks {
    fun canHandle(url: String): Boolean {
        val uri = runCatching { Uri.parse(url) }.getOrNull() ?: return false
        val apiHost = Config.baseHttpUrl.host
        if (!(uri.host.equals(apiHost, ignoreCase = true) || uri.scheme == "yard")) return false
        val path = normalisedPath(uri)
        return (path == "/auth/magic" || path == "/auth/verify") && token(uri) != null
    }

    /** Consumes the link; returns a sentence for a toast. */
    suspend fun handle(url: String, session: SessionStore): String? {
        val uri = runCatching { Uri.parse(url) }.getOrNull() ?: return null
        val token = token(uri) ?: return null
        return try {
            when (normalisedPath(uri)) {
                "/auth/magic" -> {
                    AuthAPI.consumeMagicLink(token)
                    session.didSignIn()
                    if (session.isSignedIn) "You're signed in." else "Yard couldn't confirm this sign-in. Try again."
                }
                "/auth/verify" -> {
                    val result = AuthAPI.confirmEmail(token)
                    if (result.signedIn == true) {
                        session.didSignIn()
                        "Your email is verified. You're signed in."
                    } else {
                        "Your email is verified. Sign in to continue."
                    }
                }
                else -> null
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            APIError.messageFor(APIError.network(e))
        }
    }

    private fun normalisedPath(uri: Uri): String {
        if (uri.scheme == "yard") {
            val host = uri.host ?: return uri.path.orEmpty()
            return "/" + host + uri.path.orEmpty()
        }
        return uri.path.orEmpty()
    }

    private fun token(uri: Uri): String? =
        runCatching { uri.getQueryParameter("token") }.getOrNull()?.takeIf { it.isNotEmpty() }
}
