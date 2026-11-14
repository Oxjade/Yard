package space.yardstore.app.core.stores

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import space.yardstore.app.core.models.Session
import space.yardstore.app.core.models.Shopper
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.core.networking.HTTPMethod
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.cancellation.CancellationException

/**
 * Who is signed in. Mirrors `Core/Stores/SessionStore.swift`. App-scoped; read it in composables
 * with `LocalSessionStore.current` (Compose state: reads recompose automatically).
 *
 * - [refresh] reads GET /api/session (the root calls it on launch and whenever the app resumes).
 * - [signOut] posts /api/auth/sign-out?actor=shopper and clears local state.
 * - Gate shopper-only actions with [isSignedIn], else `router.present(Route.SignIn)`.
 *
 * Call the suspend functions from the main thread (LaunchedEffect, rememberCoroutineScope, viewModelScope).
 */
class SessionStore(private val api: APIClient = APIClient.shared) {
    /** The signed-in shopper, or null. */
    var shopper: Shopper? by mutableStateOf(null)
        private set
    /** The full session (brand membership etc.), null before the first load. */
    var session: Session? by mutableStateOf(null)
        private set
    /** True while a [refresh] runs. */
    var isLoading: Boolean by mutableStateOf(false)
        private set
    /** True once the first [refresh] finished (show neutral UI rather than a "signed out" flicker). */
    var hasLoaded: Boolean by mutableStateOf(false)
        private set
    /** Last error from [refresh] (network); the previous session is kept. */
    var lastError: APIError? by mutableStateOf(null)
        private set

    private val signOutListeners = mutableListOf<suspend () -> Unit>()
    private val beforeSignOutListeners = mutableListOf<suspend () -> Unit>()

    /** A shopper is signed in. */
    val isSignedIn: Boolean get() = shopper != null

    /** Re-reads GET /api/session. */
    suspend fun refresh() {
        isLoading = true
        try {
            val s: Session = api.get("/api/session")
            session = s
            shopper = s.shopper
            lastError = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: APIError) {
            if (!e.isCancelled) lastError = e
        } catch (e: Exception) {
            lastError = APIError.network(e)
        } finally {
            isLoading = false
            hasLoaded = true
        }
    }

    /** Call after a successful sign-in/sign-up response (the cookie is already stored): re-reads the session. */
    suspend fun didSignIn() {
        refresh()
    }

    /** Signs the shopper out on the server and locally. Never throws: the user always ends signed out. */
    suspend fun signOut() {
        // While the session cookie still works (e.g. unregistering this device's push token).
        // Best effort and time-boxed: never blocks or fails the sign-out.
        for (listener in beforeSignOutListeners.toList()) {
            try {
                withTimeoutOrNull(BEFORE_SIGN_OUT_TIMEOUT_MS) { listener() }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
            }
        }
        try {
            api.send(HTTPMethod.POST, "/api/auth/sign-out", query = listOf("actor" to "shopper"))
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // The server always succeeds; a network failure still signs out locally.
        }
        shopper = null
        session = Session.signedOut
        for (listener in signOutListeners.toList()) {
            runCatching { listener() }
        }
        refresh()
    }

    /**
     * Runs [listener] after every sign-out (the iOS app ends Live Activities here). Features
     * register from their own code, e.g. notifications unregistering a push token.
     */
    fun addSignOutListener(listener: suspend () -> Unit) {
        signOutListeners += listener
    }

    /**
     * Runs [listener] at the start of every [signOut], before the server call, while the shopper
     * is still signed in (push: DELETE /api/devices). Each gets at most 3 s; failures are ignored.
     */
    fun addBeforeSignOutListener(listener: suspend () -> Unit) {
        beforeSignOutListeners += listener
    }

    companion object {
        const val BEFORE_SIGN_OUT_TIMEOUT_MS: Long = 3_000

        /** Previews only: a store that looks signed in (or out) without the network. */
        fun preview(signedIn: Boolean = true): SessionStore {
            val store = SessionStore(APIClient.shared)
            if (signedIn) store.shopper = Shopper(id = "preview", name = "Ada Obi", email = "ada@example.com")
            store.hasLoaded = true
            return store
        }
    }
}
