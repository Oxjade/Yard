package space.yardstore.app.features.auth

import android.content.SharedPreferences
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.edit
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import space.yardstore.app.core.Config
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.core.stores.SessionStore
import java.net.URI
import java.net.URLDecoder
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import kotlin.coroutines.cancellation.CancellationException

// Social sign-in for the native app (Google blocks OAuth inside WebViews, so the provider runs in a
// Custom Tab, whose cookies are not the app's). See android/Docs/connect.md.
//
//   1. [AuthAppHandoff.begin] makes a PKCE verifier, keeps it (survives process death, 10 minutes)
//      and returns GET /api/auth/oauth/{provider}/app-start?client=android&challenge=…&mode=signin&actor=shopper[&connection=…]
//   2. The Custom Tab runs the provider; the website's callback redirects to
//      yard://auth/complete?code=…&result=signed_in&provider=…&mode=…&actor=…  (or ?result=<error>&provider=…)
//   3. MainActivity hands that link to [AuthAppHandoff.complete]: POST /api/auth/oauth/app-exchange
//      { code, verifier } sets the session cookie in the app's own cookie jar, then GET /api/session.
//   4. SignInView picks up [AuthAppHandoff.outcome] and carries on exactly like a sign-in made in the
//      app (shop-or-sell choice, Welcome, close).

/** PKCE for the hand-off: a 32-byte random verifier and its S256 challenge (base64url, no padding). */
object AuthPkce {
    private val random = SecureRandom()
    private val encoder = Base64.getUrlEncoder().withoutPadding()

    /** A new verifier: 32 random bytes, base64url without padding (43 characters). */
    fun newVerifier(): String {
        val bytes = ByteArray(32)
        random.nextBytes(bytes)
        return encoder.encodeToString(bytes)
    }

    /** base64url(SHA-256(verifier)), no padding (43 characters). */
    fun challenge(verifier: String): String =
        encoder.encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)))
}

/** The `yard://auth/complete?…` link the website's OAuth callback sends the Custom Tab to. */
data class AuthHandoffCallback(
    /** The single-use hand-off code (only on success). */
    val code: String?,
    /** "signed_in" or one of the /auth/complete error results ("cancelled", "invalid_state" …). */
    val result: String,
    val provider: String?,
    val mode: String?,
    val actor: String?,
) {
    companion object {
        /** True for `yard://auth/complete` (with or without a query). */
        fun matches(url: String): Boolean {
            val uri = runCatching { URI(url.trim()) }.getOrNull() ?: return false
            return uri.scheme.equals("yard", ignoreCase = true) &&
                uri.host.equals("auth", ignoreCase = true) &&
                (uri.path ?: "").trimEnd('/') == "/complete"
        }

        /** Parses the link; null when it isn't one. A missing result is "error" (the website's default). */
        fun parse(url: String): AuthHandoffCallback? {
            if (!matches(url)) return null
            val query = queryOf(url)
            return AuthHandoffCallback(
                code = query["code"]?.takeIf { it.isNotEmpty() },
                result = query["result"]?.takeIf { it.isNotEmpty() } ?: "error",
                provider = query["provider"]?.takeIf { it.isNotEmpty() },
                mode = query["mode"]?.takeIf { it.isNotEmpty() },
                actor = query["actor"]?.takeIf { it.isNotEmpty() },
            )
        }

        private fun queryOf(url: String): Map<String, String> {
            val raw = runCatching { URI(url.trim()).rawQuery }.getOrNull() ?: return emptyMap()
            val out = LinkedHashMap<String, String>()
            for (item in raw.split("&")) {
                if (item.isEmpty()) continue
                val i = item.indexOf('=')
                val name = decode(if (i >= 0) item.substring(0, i) else item)
                val value = decode(if (i >= 0) item.substring(i + 1) else "")
                if (name != null && value != null && name !in out) out[name] = value
            }
            return out
        }

        private fun decode(s: String): String? = runCatching { URLDecoder.decode(s, "UTF-8") }.getOrNull()
    }
}

/** A social sign-in waiting for its `yard://auth/complete` link. */
data class AuthHandoffPending(
    val verifier: String,
    /** The social button's key ("auth0:google-oauth2"), for its loading state. */
    val buttonKey: String,
    /** "Google" … for messages. */
    val label: String,
    /** Epoch milliseconds. */
    val createdAt: Long,
) {
    fun isExpired(now: Long): Boolean = now - createdAt > AuthAppHandoff.PENDING_LIFETIME_MS || now < createdAt
}

/**
 * Keeps the pending verifier across process death (Android may kill the app while the Custom Tab
 * is open). SharedPreferences `yard` (Config.preferences); in memory when there are none (tests).
 */
class AuthHandoffStore(private val prefs: SharedPreferences?) {
    private var memory: AuthHandoffPending? = null

    fun save(pending: AuthHandoffPending) {
        memory = pending
        prefs?.edit(commit = true) {
            putString(KEY_VERIFIER, pending.verifier)
            putString(KEY_BUTTON, pending.buttonKey)
            putString(KEY_LABEL, pending.label)
            putLong(KEY_CREATED, pending.createdAt)
        }
    }

    fun peek(): AuthHandoffPending? {
        if (prefs == null) return memory
        val verifier = prefs.getString(KEY_VERIFIER, null) ?: return null
        return AuthHandoffPending(
            verifier = verifier,
            buttonKey = prefs.getString(KEY_BUTTON, null).orEmpty(),
            label = prefs.getString(KEY_LABEL, null).orEmpty(),
            createdAt = prefs.getLong(KEY_CREATED, 0L),
        )
    }

    /** Returns and forgets the pending sign-in (a verifier is used once). */
    fun take(): AuthHandoffPending? = peek().also { clear() }

    fun clear() {
        memory = null
        prefs?.edit(commit = true) {
            remove(KEY_VERIFIER)
            remove(KEY_BUTTON)
            remove(KEY_LABEL)
            remove(KEY_CREATED)
        }
    }

    private companion object {
        const val KEY_VERIFIER = "yard.auth.handoff.verifier"
        const val KEY_BUTTON = "yard.auth.handoff.button"
        const val KEY_LABEL = "yard.auth.handoff.label"
        const val KEY_CREATED = "yard.auth.handoff.createdAt"
    }
}

/**
 * The app side of the sign-in hand-off. App-scoped (the sign-in screen may be gone, or the process
 * restarted, by the time the Custom Tab comes back), Compose state for the sign-in screen.
 */
object AuthAppHandoff {
    const val PENDING_LIFETIME_MS: Long = 10 * 60 * 1000L

    sealed interface Outcome {
        /** The exchange set the session cookie (the session has been refreshed). */
        data class SignedIn(val isNew: Boolean, val provider: String?) : Outcome
        /** Show [message] on the sign-in screen. */
        data class Failed(val message: String) : Outcome
    }

    /** Tests only. */
    internal var storeOverride: AuthHandoffStore? = null
    internal var clock: () -> Long = { System.currentTimeMillis() }

    private var defaultStore: AuthHandoffStore? = null
    private val store: AuthHandoffStore
        get() = storeOverride ?: defaultStore ?: AuthHandoffStore(Config.preferences).also { defaultStore = it }

    /** The social button whose code is being exchanged (shows its spinner). */
    var exchangingKey: String? by mutableStateOf(null)
        private set
    /** A finished hand-off waiting for the sign-in screen ([consumeOutcome]). */
    var outcome: Outcome? by mutableStateOf(null)
        private set
    /** Sign-in screens on screen (MainActivity presents one when a hand-off arrives and there is none). */
    var activeScreens: Int by mutableIntStateOf(0)
        private set

    /** Counts the times the last sign-in screen went away (see [complete]). */
    private var closings = 0

    fun screenAppeared() { activeScreens += 1 }

    /**
     * When the last sign-in screen goes away, an outcome nobody read is dropped, so a later
     * sign-in screen never shows a stale success or error.
     */
    fun screenDisappeared() {
        activeScreens = (activeScreens - 1).coerceAtLeast(0)
        if (activeScreens == 0) {
            closings += 1
            outcome = null
        }
    }

    fun consumeOutcome(): Outcome? = outcome.also { outcome = null }

    /** True when a sign-in started by [begin] is still waiting (and not expired). */
    fun hasPending(): Boolean = store.peek()?.let { !it.isExpired(clock()) } ?: false

    /**
     * Starts a social sign-in: a new verifier (replacing any earlier one) and the app-start URL to
     * open in a Custom Tab.
     */
    fun begin(button: AuthSocialButton, base: HttpUrl = Config.baseHttpUrl): String {
        val verifier = AuthPkce.newVerifier()
        store.save(AuthHandoffPending(verifier = verifier, buttonKey = button.key, label = button.label, createdAt = clock()))
        outcome = null
        return appStartUrl(button, AuthPkce.challenge(verifier), base)
    }

    /** GET /api/auth/oauth/{provider}/app-start?client=android&challenge=…&mode=signin&actor=shopper[&connection=…]. */
    fun appStartUrl(button: AuthSocialButton, challenge: String, base: HttpUrl = Config.baseHttpUrl): String {
        val b = base.newBuilder()
            .encodedPath("/")
            .query(null)
            .fragment(null)
            .addPathSegments("api/auth/oauth")
            .addPathSegment(button.provider)
            .addPathSegment("app-start")
            .addQueryParameter("client", "android")
            .addQueryParameter("challenge", challenge)
            .addQueryParameter("mode", "signin")
            .addQueryParameter("actor", "shopper")
        if (!button.connection.isNullOrEmpty()) b.addQueryParameter("connection", button.connection)
        return b.build().toString()
    }

    fun canHandle(url: String): Boolean = AuthHandoffCallback.matches(url)

    /**
     * Finishes a hand-off from its `yard://auth/complete` link: exchanges the code, refreshes
     * [session] and publishes [outcome]. With [onlyIfPending] (an activity restored with an old
     * intent) a link with no waiting sign-in is ignored instead of reported as expired.
     */
    suspend fun complete(url: String, session: SessionStore?, onlyIfPending: Boolean = false): Outcome? {
        val callback = AuthHandoffCallback.parse(url) ?: return null
        if (onlyIfPending && !hasPending()) return null
        val closingsAtStart = closings
        val pending = store.take()
        val label = pending?.label?.takeIf { it.isNotEmpty() } ?: "social"
        val result: Outcome = when {
            callback.code == null -> Outcome.Failed(AuthOAuthResult.message(callback.result))
            pending == null || pending.isExpired(clock()) -> Outcome.Failed(AuthOAuthResult.message("invalid_state"))
            else -> exchange(callback, pending, label, session)
        }
        // The sign-in screen was closed while the code was being exchanged and none has opened
        // since: nobody is waiting for this result (the session was still refreshed on success).
        val abandoned = closings != closingsAtStart && activeScreens == 0
        if (!abandoned) outcome = result
        return result
    }

    private suspend fun exchange(callback: AuthHandoffCallback, pending: AuthHandoffPending, label: String, session: SessionStore?): Outcome {
        exchangingKey = pending.buttonKey
        try {
            val response = AuthAPI.exchangeAppCode(code = callback.code.orEmpty(), verifier = pending.verifier)
            if (response.isMfaRequired) return Outcome.Failed(MFA_MESSAGE)
            val result = response.result.ifEmpty { if (response.status == "signed_in") "signed_in" else callback.result }
            if (result != "signed_in") return Outcome.Failed(AuthOAuthResult.message(result))
            session?.didSignIn()
            return Outcome.SignedIn(isNew = response.isNew, provider = callback.provider)
        } catch (e: CancellationException) {
            throw e
        } catch (e: APIError) {
            if (e.status == 400 || e.code == "invalid_code") return Outcome.Failed(AuthOAuthResult.message("invalid_state"))
            return Outcome.Failed(e.message.ifEmpty { "Couldn't finish $label sign-in. Try again." })
        } catch (e: Exception) {
            return Outcome.Failed("Couldn't finish $label sign-in. ${APIError.messageFor(APIError.network(e))}")
        } finally {
            exchangingKey = null
        }
    }

    /** Admin accounts with two-step sign-in: the app has no MFA screens (same as the password form). */
    const val MFA_MESSAGE = "This account needs a second sign-in step. Sign in on the Yard website to continue."

    /** Tests only: forget everything. */
    internal fun resetForTests() {
        outcome = null
        exchangingKey = null
        activeScreens = 0
        closings = 0
        storeOverride?.clear()
    }
}

/** For callers that only have a base URL string (tests). */
internal fun httpUrl(base: String): HttpUrl = base.toHttpUrlOrNull() ?: Config.baseHttpUrl
