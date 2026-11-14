package space.yardstore.app.features.you

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Login
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.MarkEmailUnread
import androidx.compose.material.icons.outlined.PhoneIphone
import androidx.compose.material.icons.outlined.Verified
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.app.Route
import space.yardstore.app.core.Formatters
import space.yardstore.app.core.WebPages
import space.yardstore.app.core.models.YardDate
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.core.networking.HTTPMethod
import space.yardstore.app.core.stores.LocalSessionStore
import space.yardstore.app.designsystem.Radius
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardTabletPreviews
import space.yardstore.app.designsystem.components.Card
import space.yardstore.app.designsystem.components.EmptyState
import space.yardstore.app.designsystem.components.LocalToastCenter
import space.yardstore.app.designsystem.components.Skeleton
import space.yardstore.app.designsystem.components.Tag
import space.yardstore.app.designsystem.components.TagStyle
import space.yardstore.app.designsystem.components.Toast
import space.yardstore.app.designsystem.components.YardButton
import space.yardstore.app.designsystem.components.YardButtonSize
import space.yardstore.app.designsystem.components.YardButtonStyle
import space.yardstore.app.designsystem.components.YardTopBar
import space.yardstore.app.designsystem.components.adaptiveContentWidth
import space.yardstore.app.designsystem.components.yardScreenBackground
import space.yardstore.app.designsystem.yard
import space.yardstore.app.features.auth.AuthAPI
import space.yardstore.app.features.auth.AuthAppHandoff
import space.yardstore.app.features.auth.AuthSocialButton
import androidx.compose.foundation.shape.RoundedCornerShape

// You › Settings › Your details: the signed-in person's name and email (docs/APP.md › Account:
// name and email; website src/components/market/account/account-details.tsx).
//   GET    /api/account?as=shopper                       → { account }
//   PATCH  /api/account?as=shopper { name }              → { account } (saved at once)
//   POST   /api/account/email?as=shopper { email, currentPassword? } → { account } with pendingEmail
//   DELETE /api/account/email?as=shopper                 → { account } with pendingEmail: null
// The email only changes once the link sent to the NEW address is opened (in a browser, or in the
// app through AuthEmailLinks); this screen re-reads the account whenever it comes back to the front.

// MARK: - API models

/** `pendingEmail`: a change waiting for its link to be opened. */
@Serializable
data class YouPendingEmail(val email: String = "", val expiresAt: String = "")

/** `AccountDto`. */
@Serializable
data class YouAccount(
    val name: String = "",
    val email: String = "",
    val emailVerified: Boolean = false,
    val hasPassword: Boolean = false,
    /** Linked sign-in identities, sorted ("apple", "auth0", "google"); empty when none. */
    val signInProviders: List<String> = emptyList(),
    val pendingEmail: YouPendingEmail? = null,
    val demo: Boolean = false,
) {
    /** "Google and Apple" for the note under the email (auth0 reads as social sign-in, as on the website). */
    val providerWords: List<String>
        get() = signInProviders.map {
            when (it) {
                "google" -> "Google"
                "apple" -> "Apple"
                "auth0" -> "social sign-in"
                else -> it
            }
        }.distinct()
}

@Serializable
data class YouAccountResponse(val account: YouAccount)

/** PATCH /api/account body. */
@Serializable
data class YouAccountNameBody(val name: String)

/** POST /api/account/email body (`currentPassword` is left out for accounts without a password). */
@Serializable
data class YouEmailChangeBody(val email: String, val currentPassword: String? = null)

// MARK: - Rules (same as sign-up and the website's account form)

/** The name rules: trimmed, 1–80 characters, no control characters and no `<` `>`. Null = fine. */
internal fun youNameError(name: String): String? {
    val n = name.trim()
    return when {
        n.isEmpty() -> "Enter your name."
        n.length > 80 -> "Keep it to 80 characters."
        n.any { it.code < 0x20 || it.code == 0x7f || it == '<' || it == '>' } -> "Use letters, numbers and simple punctuation."
        else -> null
    }
}

private val youEmailRegex = Regex("^\\S+@\\S+\\.\\S+$")

/** Client-side checks before POST /api/account/email (field name → message). */
internal fun youEmailChangeErrors(account: YouAccount, email: String, currentPassword: String): Map<String, String> {
    val out = mutableMapOf<String, String>()
    val to = email.trim()
    when {
        !youEmailRegex.matches(to) -> out["email"] = "Enter an email address like name@example.com."
        to.equals(account.email, ignoreCase = true) -> out["email"] = "That's already your email."
    }
    if (account.hasPassword && currentPassword.isEmpty()) out["currentPassword"] = "Enter your current password."
    return out
}

// MARK: - Model

class YouAccountModel(
    private val api: APIClient = APIClient.shared,
    /** URL prefix for the API paths ("" = the configured base URL; tests point it at a mock server). */
    private val root: String = "",
) : ViewModel() {
    sealed interface Phase {
        data object Idle : Phase
        data object Loading : Phase
        data object Loaded : Phase
        data class Failed(val message: String) : Phase
    }

    var phase by mutableStateOf<Phase>(Phase.Idle); private set
    var account by mutableStateOf<YouAccount?>(null); private set

    var isSavingName by mutableStateOf(false); private set
    var nameError by mutableStateOf<String?>(null); private set

    var isSendingLink by mutableStateOf(false); private set
    var isCancelling by mutableStateOf(false); private set
    /** Field errors for the email form ("email", "currentPassword"). */
    var emailErrors by mutableStateOf<Map<String, String>>(emptyMap()); private set
    /** A form-level error (rate limit, demo account, network…). */
    var emailFormError by mutableStateOf<String?>(null); private set
    /** 403 `fields.reauth = "required"`: an account without a password must re-confirm (sign in again) first. */
    var needsReauth by mutableStateOf(false); private set

    fun load() = viewModelScope.launch { fetch() }

    /** GET /api/account?as=shopper. Keeps what it has on a failed refresh. */
    suspend fun fetch() {
        if (account == null) phase = Phase.Loading
        try {
            account = api.get<YouAccountResponse>("$root/api/account", youAsShopper).account
            phase = Phase.Loaded
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (e is APIError && e.isCancelled) return
            if (account == null) phase = Phase.Failed(APIError.messageFor(e))
        }
    }

    fun reset() {
        account = null
        phase = Phase.Idle
        clearEmailErrors()
    }

    fun clearNameError() { nameError = null }

    fun clearEmailErrors(field: String? = null) {
        emailErrors = if (field == null) emptyMap() else emailErrors - field
        emailFormError = null
        if (field == null) needsReauth = false
    }

    /** PATCH /api/account?as=shopper { name } (trimmed). True when saved. */
    suspend fun saveName(name: String): Boolean {
        val problem = youNameError(name)
        nameError = problem
        if (problem != null || isSavingName) return false
        isSavingName = true
        try {
            account = api.patch<YouAccountResponse>("$root/api/account", YouAccountNameBody(name.trim()), youAsShopper).account
            return true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (e is APIError && e.isCancelled) return false
            nameError = (e as? APIError)?.fields?.get("name") ?: APIError.messageFor(e)
            return false
        } finally {
            isSavingName = false
        }
    }

    /**
     * POST /api/account/email?as=shopper { email, currentPassword? }. True when the link was sent
     * (the account now has `pendingEmail`). On 403 reauth, [needsReauth] turns on.
     */
    suspend fun requestEmailChange(email: String, currentPassword: String): Boolean {
        val a = account ?: return false
        val local = youEmailChangeErrors(a, email, currentPassword)
        emailErrors = local
        emailFormError = null
        if (local.isNotEmpty() || isSendingLink) return false
        isSendingLink = true
        try {
            val body = YouEmailChangeBody(email.trim(), currentPassword = if (a.hasPassword) currentPassword else null)
            account = api.post<YouAccountResponse>("$root/api/account/email", body, youAsShopper).account
            needsReauth = false
            return true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (e is APIError && e.isCancelled) return false
            applyEmailFailure(e)
            return false
        } finally {
            isSendingLink = false
        }
    }

    private fun applyEmailFailure(e: Exception) {
        val api = e as? APIError
        when {
            api == null -> emailFormError = APIError.messageFor(e)
            api.youNeedsReauth -> {
                needsReauth = true
                emailFormError = null
            }
            api.fields["email"] != null || api.fields["currentPassword"] != null ->
                emailErrors = api.fields.filterKeys { it == "email" || it == "currentPassword" }
            else -> emailFormError = api.message
        }
    }

    /** DELETE /api/account/email?as=shopper: the sent link stops working. True when cancelled. */
    suspend fun cancelEmailChange(): Boolean {
        if (isCancelling) return false
        isCancelling = true
        try {
            account = api.delete<YouAccountResponse>("$root/api/account/email", query = youAsShopper).account
            return true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (e is APIError && e.isCancelled) return false
            emailFormError = APIError.messageFor(e)
            return false
        } finally {
            isCancelling = false
        }
    }
}

// MARK: - Screen

@Composable
fun YouAccountView() {
    val session = LocalSessionStore.current
    val router = LocalRouter.current
    val model: YouAccountModel = viewModel { YouAccountModel() }

    LaunchedEffect(session.shopper?.id) { if (session.isSignedIn) model.load() else model.reset() }
    // The link is usually opened in the mail app or browser: re-read when Yard comes back, and
    // whenever the session's email changes (e.g. the link was opened in the app).
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { if (session.isSignedIn && model.account != null) model.load() }
    LaunchedEffect(session.shopper?.email) { if (session.isSignedIn && model.account != null) model.load() }

    Column(Modifier.fillMaxSize().yardScreenBackground()) {
        YardTopBar("Your details")
        when {
            !session.isSignedIn && session.hasLoaded -> EmptyState.SignedOut(
                message = "Sign in to change your name and email.",
                modifier = Modifier.weight(1f).adaptiveContentWidth(),
            ) { router.present(Route.SignIn) }
            else -> when (val phase = model.phase) {
                YouAccountModel.Phase.Idle, YouAccountModel.Phase.Loading -> YouAccountSkeleton()
                is YouAccountModel.Phase.Failed -> EmptyState.Error(
                    message = phase.message,
                    modifier = Modifier.weight(1f).adaptiveContentWidth(),
                ) { model.fetch() }
                YouAccountModel.Phase.Loaded -> model.account?.let { YouAccountContent(model, it, Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun YouAccountContent(model: YouAccountModel, account: YouAccount, modifier: Modifier) {
    Column(
        modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .imePadding()
            .navigationBarsPadding(),
    ) {
        Column(
            Modifier
                .adaptiveContentWidth()
                .padding(horizontal = Spacing.gutter)
                .padding(top = Spacing.m, bottom = Spacing.xxl),
            verticalArrangement = Arrangement.spacedBy(Spacing.xl),
        ) {
            YouNameSection(model, account)
            YouEmailSection(model, account)
        }
    }
}

@Composable
private fun YouNameSection(model: YouAccountModel, account: YouAccount) {
    val session = LocalSessionStore.current
    val toast = LocalToastCenter.current
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    var name by rememberSaveable(account.name) { mutableStateOf(account.name) }
    val changed = name.trim() != account.name

    YouSettingsGroup("Name", footer = "Goes on your orders and shows to brands you message.") {
        Column(Modifier.padding(Spacing.m), verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
            YouTextField(
                "Name", name,
                {
                    name = it
                    model.clearNameError()
                },
                error = model.nameError,
                capitalization = KeyboardCapitalization.Words,
            )
            YardButton(
                "Save name",
                size = YardButtonSize.Medium,
                isLoading = model.isSavingName,
                enabled = changed,
            ) {
                scope.launch {
                    if (model.saveName(name)) {
                        haptics.performHapticFeedback(HapticFeedbackType.Confirm)
                        toast.show("Name saved.", Toast.Style.Success)
                        session.refresh() // You and the sign-in header show the new name at once
                    }
                }
            }
        }
    }
}

@Composable
private fun YouEmailSection(model: YouAccountModel, account: YouAccount) {
    val toast = LocalToastCenter.current
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    var changing by rememberSaveable { mutableStateOf(false) }
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }

    fun closeForm() {
        changing = false
        email = ""
        password = ""
        model.clearEmailErrors()
    }

    fun send(to: String) {
        scope.launch {
            if (model.requestEmailChange(to, password)) {
                haptics.performHapticFeedback(HapticFeedbackType.Confirm)
                toast.show("Check your new inbox. We sent a link to ${to.trim()}.", Toast.Style.Success)
                changing = false
                email = ""
                password = ""
            } else if (!changing && (model.needsReauth || model.emailErrors.isNotEmpty())) {
                // A resend from the pending card that needs a step or a fix: show the form for it.
                email = to
                changing = true
            }
        }
    }

    val footer = if (account.providerWords.isNotEmpty())
        "You also sign in with ${account.providerWords.joinToString(" and ")}; that keeps working after a change."
    else
        "Sign-in links, order updates and receipts go here."

    YouSettingsGroup("Email", footer = footer) {
        Column(Modifier.padding(Spacing.m), verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
                Icon(Icons.Outlined.Email, contentDescription = null, tint = Color.yard.ink2, modifier = Modifier.size(18.dp))
                Text(account.email, style = YardFonts.body, color = Color.yard.ink, modifier = Modifier.weight(1f, fill = false))
                if (account.emailVerified) Tag("Verified", icon = Icons.Outlined.Verified)
            }

            account.pendingEmail?.let { pending ->
                YouPendingEmailCard(
                    pending,
                    isCancelling = model.isCancelling,
                    isResending = model.isSendingLink && !changing,
                    onResend = {
                        if (account.hasPassword) {
                            // A new link needs the password again: open the form with the address filled in.
                            email = pending.email
                            changing = true
                        } else {
                            send(pending.email)
                        }
                    },
                    onDifferent = {
                        email = ""
                        changing = true
                    },
                    onCancel = {
                        scope.launch {
                            if (model.cancelEmailChange()) {
                                toast.show("Email change cancelled. The link we sent no longer works.", Toast.Style.Info)
                                closeForm()
                            }
                        }
                    },
                )
            }

            when {
                account.demo -> Text("Demo accounts can't change their email.", style = YardFonts.callout, color = Color.yard.ink2)
                changing -> {
                    YouTextField(
                        "New email", email,
                        {
                            email = it
                            model.clearEmailErrors("email")
                        },
                        error = model.emailErrors["email"],
                        keyboardType = KeyboardType.Email,
                    )
                    if (account.hasPassword) {
                        YouTextField(
                            "Current password", password,
                            {
                                password = it
                                model.clearEmailErrors("currentPassword")
                            },
                            isSecure = true,
                            error = model.emailErrors["currentPassword"],
                        )
                    }
                    if (model.needsReauth && !account.hasPassword) {
                        YouReauthPanel(account, onConfirmed = { send(email) })
                    }
                    model.emailFormError?.let { Text(it, style = YardFonts.callout, color = Color.yard.danger) }
                    Text(
                        "We'll email a link to the new address. Your email changes only when you open it, and we tell your current address.",
                        style = YardFonts.caption,
                        color = Color.yard.ink3,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
                        YardButton(
                            "Send link",
                            size = YardButtonSize.Medium,
                            fullWidth = false,
                            isLoading = model.isSendingLink,
                            enabled = email.isNotBlank() && (!account.hasPassword || password.isNotEmpty()),
                        ) { send(email) }
                        YardButton("Cancel", style = YardButtonStyle.Ghost, size = YardButtonSize.Medium, fullWidth = false, enabled = !model.isSendingLink) { closeForm() }
                    }
                }
                account.pendingEmail == null -> {
                    model.emailFormError?.let { Text(it, style = YardFonts.callout, color = Color.yard.danger) }
                    YardButton("Change email", style = YardButtonStyle.Secondary, size = YardButtonSize.Medium, fullWidth = false) { changing = true }
                }
                else -> model.emailFormError?.let { Text(it, style = YardFonts.callout, color = Color.yard.danger) }
            }
        }
    }
}

@Composable
private fun YouPendingEmailCard(
    pending: YouPendingEmail,
    isCancelling: Boolean,
    isResending: Boolean,
    onResend: () -> Unit,
    onDifferent: () -> Unit,
    onCancel: () -> Unit,
) {
    val expires = YardDate.parse(pending.expiresAt)?.let { " The link expires ${Formatters.dateTime(it)}." } ?: ""
    Column(
        Modifier
            .fillMaxWidth()
            .border(1.dp, Color.yard.line, RoundedCornerShape(Radius.small))
            .padding(Spacing.m),
        verticalArrangement = Arrangement.spacedBy(Spacing.m),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
            Icon(Icons.Outlined.MarkEmailUnread, contentDescription = null, tint = Color.yard.violet, modifier = Modifier.size(18.dp))
            Text(
                "We sent a link to ${pending.email}. Your email changes once you open it.$expires",
                style = YardFonts.callout,
                color = Color.yard.ink,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
            YardButton("Resend link", style = YardButtonStyle.Secondary, size = YardButtonSize.Small, fullWidth = false, isLoading = isResending, onClick = onResend)
            YardButton("Use a different email", style = YardButtonStyle.Secondary, size = YardButtonSize.Small, fullWidth = false, onClick = onDifferent)
        }
        YardButton("Cancel change", style = YardButtonStyle.Ghost, size = YardButtonSize.Small, fullWidth = false, isLoading = isCancelling, onClick = onCancel)
    }
}

/**
 * The step-up for an account without a password (403 `reauth`): sign in again with one of its
 * providers through the normal Custom Tab hand-off; the fresh session counts as re-confirmed for
 * 10 minutes, so the change is sent again as soon as the hand-off comes back.
 */
@Composable
private fun YouReauthPanel(account: YouAccount, onConfirmed: () -> Unit) {
    val context = LocalContext.current
    val session = LocalSessionStore.current
    val dark = Color.yard.isDark
    var buttons by remember { mutableStateOf<List<AuthSocialButton>?>(null) }
    var waiting by rememberSaveable { mutableStateOf(false) }
    var startedAs by rememberSaveable { mutableStateOf<String?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    val confirmed by rememberUpdatedState(onConfirmed)

    LaunchedEffect(account.signInProviders) {
        buttons = try {
            AuthSocialButton.buttons(AuthAPI.providers()).filter { it.provider in account.signInProviders }
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            if ("auth0" in account.signInProviders) listOf(AuthSocialButton.auth0Google) else emptyList()
        }
    }
    // While a hand-off is out, this screen is the one waiting for it (MainActivity then doesn't
    // open the sign-in sheet over it).
    if (waiting) {
        DisposableEffect(Unit) {
            AuthAppHandoff.screenAppeared()
            onDispose { AuthAppHandoff.screenDisappeared() }
        }
    }
    val outcome = AuthAppHandoff.outcome
    LaunchedEffect(outcome, waiting) {
        if (!waiting || outcome == null) return@LaunchedEffect
        AuthAppHandoff.consumeOutcome()
        waiting = false
        when (outcome) {
            is AuthAppHandoff.Outcome.SignedIn ->
                if (session.shopper?.id == startedAs) confirmed()
                else message = "You signed in to a different account, so your email wasn't changed."
            is AuthAppHandoff.Outcome.Failed -> message = outcome.message
        }
    }

    Card(padding = Spacing.m) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
            Text("Confirm it's you", style = YardFonts.headline, color = Color.yard.ink)
            val list = buttons
            Text(
                if (list != null && list.isEmpty())
                    "Changing your email needs you to confirm it's you. Sign out, sign back in, then change your email within 10 minutes."
                else
                    "Changing your email needs you to confirm it's you. Sign in again, then we send the link.",
                style = YardFonts.callout,
                color = Color.yard.ink2,
            )
            when {
                list == null -> Skeleton(Modifier.fillMaxWidth().height(44.dp), cornerRadius = 22.dp)
                else -> list.forEach { button ->
                    YardButton(
                        "Continue with ${button.label}",
                        icon = when (button.mark) {
                            AuthSocialButton.Mark.Google -> Icons.Outlined.AccountCircle
                            AuthSocialButton.Mark.Apple -> Icons.Outlined.PhoneIphone
                            AuthSocialButton.Mark.Generic -> Icons.AutoMirrored.Outlined.Login
                        },
                        style = YardButtonStyle.Secondary,
                        size = YardButtonSize.Medium,
                        isLoading = waiting && AuthAppHandoff.exchangingKey == button.key,
                    ) {
                        message = null
                        startedAs = session.shopper?.id
                        waiting = true
                        WebPages.open(context, AuthAppHandoff.begin(button), darkTheme = dark)
                    }
                }
            }
            message?.let { Text(it, style = YardFonts.callout, color = Color.yard.danger) }
        }
    }
}

@Composable
private fun YouAccountSkeleton() {
    Column(
        Modifier.adaptiveContentWidth().padding(Spacing.gutter),
        verticalArrangement = Arrangement.spacedBy(Spacing.l),
    ) {
        Skeleton(Modifier.fillMaxWidth().height(132.dp), cornerRadius = Radius.card)
        Skeleton(Modifier.fillMaxWidth().height(160.dp), cornerRadius = Radius.card)
    }
}

@Preview(name = "Your details — dark")
@Composable
private fun YouAccountDark() = YardPreview(darkTheme = true) { YouAccountView() }

@Preview(name = "Your details — light")
@Composable
private fun YouAccountLight() = YardPreview(darkTheme = false, signedIn = false) { YouAccountView() }

@YardTabletPreviews
@Composable
private fun YouAccountTablet() = YardPreview(darkTheme = true) { YouAccountView() }

/** The loaded form with a pending change (fixture; preview only). */
@Preview(name = "Your details — pending (light)")
@Composable
private fun YouAccountPendingLight() = YardPreview(darkTheme = false) {
    val model = remember { YouAccountModel() }
    YouAccountContent(
        model,
        YouAccount(
            name = "Ada Nwosu", email = "ada@example.com", emailVerified = true, hasPassword = true,
            signInProviders = listOf("google"),
            pendingEmail = YouPendingEmail("ada.new@example.com", "2026-11-15T10:00:00Z"),
        ),
        Modifier.fillMaxSize(),
    )
}
