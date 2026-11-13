package space.yardstore.app.features.auth

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch
import space.yardstore.app.core.networking.APIError
import kotlin.coroutines.cancellation.CancellationException

/**
 * Form state and actions for SignInView (mirrors the website's AuthForm,
 * src/components/market/auth-prompt.tsx: same checks, same sentences). Mirrors SignInModel.swift.
 *
 * The actions that end in a sign-in ([submit], [signInDemo]) are suspend functions the view calls
 * from its coroutine scope, because the view then refreshes the session and navigates.
 */
class SignInModel(
    previewProviders: AuthProviders? = null,
    /**
     * Keeps what the shopper typed (name, email, mode, the sign-up "check your email" address)
     * across process death. Never the password.
     */
    private val savedState: SavedStateHandle? = null,
) : ViewModel() {
    enum class Mode { SignIn, SignUp }

    sealed interface Busy {
        data object Email : Busy
        data object SignUp : Busy
        data object Forgot : Busy
        data object Magic : Busy
        data object Demo : Busy
        data class Social(val key: String) : Busy
    }

    enum class Field { Name, Email, Password }

    private var modeState by mutableStateOf(if (savedState?.get<Boolean>(KEY_SIGN_UP) == true) Mode.SignUp else Mode.SignIn)
    var mode: Mode
        get() = modeState
        private set(value) { modeState = value; savedState?.set(KEY_SIGN_UP, value == Mode.SignUp) }

    private var nameState by mutableStateOf(savedState?.get<String>(KEY_NAME) ?: "")
    var name: String
        get() = nameState
        set(value) { nameState = value; savedState?.set(KEY_NAME, value) }

    private var emailState by mutableStateOf(savedState?.get<String>(KEY_EMAIL) ?: "")
    var email: String
        get() = emailState
        set(value) { emailState = value; savedState?.set(KEY_EMAIL, value) }

    var password by mutableStateOf("")
    var isPasswordRevealed by mutableStateOf(false)

    var nameError by mutableStateOf<String?>(null); private set
    var emailError by mutableStateOf<String?>(null); private set
    var passwordError by mutableStateOf<String?>(null); private set
    /** A non-field error (server sentence), shown in danger under the form. */
    var failure by mutableStateOf<String?>(null); private set
    /** A neutral notice ("If an account exists… a sign-in link has been sent."). */
    var notice by mutableStateOf<String?>(null); private set
    /** Set after sign-up: the address the verification link went to. */
    private var signUpSentToState by mutableStateOf(savedState?.get<String>(KEY_SENT_TO))
    var signUpSentTo: String?
        get() = signUpSentToState
        private set(value) { signUpSentToState = value; savedState?.set(KEY_SENT_TO, value) }

    var busy by mutableStateOf<Busy?>(null); private set
    /** The social sign-in being shown in the web sheet. */
    var webFlow by mutableStateOf<AuthWebFlow?>(null); private set
    /** The social button that started [webFlow]. */
    private var webFlowButton: AuthSocialButton? = null

    var providers by mutableStateOf(previewProviders); private set
    var providersLoaded by mutableStateOf(previewProviders != null); private set
    private var providersFailed by mutableStateOf(false)

    // region Providers

    val socialButtons: List<AuthSocialButton>
        get() = if (providersFailed) listOf(AuthSocialButton.auth0Google) else AuthSocialButton.buttons(providers)

    val magicLinkEnabled: Boolean get() = providers?.magicLink ?: true
    val demoEnabled: Boolean get() = providers?.demoShopper ?: false

    fun loadProviders() {
        if (providersLoaded) return
        viewModelScope.launch {
            try {
                providers = AuthAPI.providers()
                providersFailed = false
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // Offer the site's default (Google via Auth0); the start call reports if it's off.
                providersFailed = true
            }
            providersLoaded = true
        }
    }

    // endregion

    // region Validation (website wording)

    private fun nameProblem(name: String): String? = if (name.isBlank()) "Enter your name." else null

    private fun emailProblem(email: String): String? {
        val trimmed = email.trim()
        if (trimmed.isEmpty()) return "Enter your email address."
        if (!EMAIL_REGEX.matches(trimmed)) return "Enter an email address like name@example.com."
        return null
    }

    private fun passwordProblem(password: String): String? {
        if (password.isEmpty()) return "Enter your password."
        // New passwords need 10+ characters (server rule); existing ones are checked by the server.
        if (mode == Mode.SignUp && password.length < 10) return "Use at least 10 characters for your password."
        return null
    }

    val trimmedEmail: String get() = email.trim()

    /** Clears a field's error as soon as the field becomes valid (call on every change). */
    fun revalidate(field: Field) {
        when (field) {
            Field.Name -> if (nameError != null && nameProblem(name) == null) nameError = null
            Field.Email -> if (emailError != null && emailProblem(email) == null) emailError = null
            Field.Password -> if (passwordError != null && passwordProblem(password) == null) passwordError = null
        }
    }

    fun toggleMode() {
        mode = if (mode == Mode.SignIn) Mode.SignUp else Mode.SignIn
        failure = null
        notice = null
        nameError = null
        emailError = null
        passwordError = null
    }

    fun backToSignIn() {
        signUpSentTo = null
        mode = Mode.SignIn
        password = ""
        failure = null
        notice = null
    }

    // endregion

    // region Actions

    /**
     * Sign in or create the account. Returns true when the server signed the shopper in
     * (the caller then refreshes the session). Reports the first invalid field through [focus].
     */
    suspend fun submit(focus: (Field) -> Unit): Boolean {
        nameError = if (mode == Mode.SignUp) nameProblem(name) else null
        emailError = emailProblem(email)
        passwordError = passwordProblem(password)
        if (nameError != null) { focus(Field.Name); return false }
        if (emailError != null) { focus(Field.Email); return false }
        if (passwordError != null) { focus(Field.Password); return false }
        if (busy != null) return false

        val signingUp = mode == Mode.SignUp
        busy = if (signingUp) Busy.SignUp else Busy.Email
        failure = null
        notice = null
        try {
            if (signingUp) {
                AuthAPI.signUp(name = name.trim(), email = trimmedEmail, password = password)
                signUpSentTo = trimmedEmail
                password = ""
                return false
            }
            val result = AuthAPI.signIn(email = trimmedEmail, password = password)
            return when (result.status) {
                "signed_in" -> true
                "verify_email" -> {
                    failure = "Check your email for a verification link, then sign in again."
                    false
                }
                else -> {
                    failure = "Couldn't sign in. Check your email and password, then try again."
                    false
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            apply(e, fallback = "Couldn't sign in. Check your email and password, then try again.", focus = focus)
            return false
        } finally {
            busy = null
        }
    }

    fun requestMagicLink(focus: (Field) -> Unit) {
        val email = validEmailForLink(focus) ?: return
        if (busy != null) return
        busy = Busy.Magic
        failure = null
        notice = null
        viewModelScope.launch {
            try {
                AuthAPI.requestMagicLink(email)
                notice = "If an account exists for that address, a sign-in link has been sent."
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failure = message(e, fallback = "Couldn't request a sign-in link. Try again.")
            } finally {
                busy = null
            }
        }
    }

    fun requestPasswordReset(focus: (Field) -> Unit) {
        val email = validEmailForLink(focus) ?: return
        if (busy != null) return
        busy = Busy.Forgot
        failure = null
        notice = null
        viewModelScope.launch {
            try {
                AuthAPI.requestPasswordReset(email)
                notice = "If an account exists for that address, a password reset link has been sent."
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failure = message(e, fallback = "Couldn't request a reset link. Try again.")
            } finally {
                busy = null
            }
        }
    }

    /** Demo shopper (only offered when the server allows it). Returns true when signed in. */
    suspend fun signInDemo(): Boolean {
        if (busy != null) return false
        busy = Busy.Demo
        failure = null
        notice = null
        return try {
            AuthAPI.signInDemo()
            true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            failure = message(e, fallback = "Couldn't sign in. Check your connection and try again.")
            false
        } finally {
            busy = null
        }
    }

    /** Starts a social sign-in; on success [webFlow] is set and the view shows the web sheet. */
    fun startSocial(button: AuthSocialButton) {
        if (busy != null) return
        busy = Busy.Social(button.key)
        failure = null
        notice = null
        viewModelScope.launch {
            try {
                val url = AuthAPI.startOAuth(button)
                webFlowButton = button
                webFlow = AuthWebFlow(url = url, label = button.label)
            } catch (e: CancellationException) {
                busy = null
                throw e
            } catch (e: Exception) {
                busy = null
                failure = message(e, fallback = "Couldn't start ${button.label} sign-in. Try again.")
            }
        }
    }

    /**
     * The web sheet ended. Returns true when the server reported `signed_in` (the caller then
     * refreshes the session and confirms a shopper is really there).
     */
    fun finishSocial(outcome: AuthWebOutcome): Boolean {
        webFlow = null
        busy = null
        val label = webFlowButton?.label ?: "social"
        webFlowButton = null
        return when (outcome) {
            is AuthWebOutcome.Completed -> {
                if (outcome.result == "signed_in") {
                    true
                } else {
                    failure = AuthOAuthResult.message(outcome.result)
                    false
                }
            }
            AuthWebOutcome.Cancelled -> false
            is AuthWebOutcome.Failed -> {
                failure = "Couldn't finish $label sign-in. ${outcome.message}"
                false
            }
        }
    }

    /** The server answered "signed in" but GET /api/session shows no shopper. */
    fun reportUnconfirmedSignIn() {
        failure = "Yard couldn’t confirm this sign-in. Try again."
    }

    // endregion

    // region Helpers

    private fun validEmailForLink(focus: (Field) -> Unit): String? {
        val problem = emailProblem(email)
        if (problem != null) {
            emailError = problem
            focus(Field.Email)
            return null
        }
        return trimmedEmail
    }

    private fun message(error: Throwable, fallback: String): String {
        val api = error as? APIError
        return if (api != null && api.message.isNotEmpty()) api.message else fallback
    }

    /** Server field messages go under their fields; anything else is the summary line. */
    private fun apply(error: Throwable, fallback: String, focus: (Field) -> Unit) {
        val api = error as? APIError
        if (api != null && api.isCancelled) return
        if (api != null && api.fields.isNotEmpty()) {
            val n = if (mode == Mode.SignUp) api.fields["name"] else null
            val e = api.fields["email"]
            val p = api.fields["password"]
            if (n != null || e != null || p != null) {
                nameError = n
                emailError = e
                passwordError = p
                failure = null
                when {
                    n != null -> focus(Field.Name)
                    e != null -> focus(Field.Email)
                    else -> focus(Field.Password)
                }
                return
            }
        }
        failure = message(error, fallback)
    }

    // endregion

    internal companion object {
        val EMAIL_REGEX = Regex("^\\S+@\\S+\\.\\S+$")
        const val KEY_SIGN_UP = "signIn.signUp"
        const val KEY_NAME = "signIn.name"
        const val KEY_EMAIL = "signIn.email"
        const val KEY_SENT_TO = "signIn.sentTo"
    }
}
