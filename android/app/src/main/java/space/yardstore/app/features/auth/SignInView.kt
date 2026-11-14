package space.yardstore.app.features.auth

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.MailOutline
import androidx.compose.material.icons.outlined.MarkEmailUnread
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.isSpecified
import androidx.compose.ui.unit.sp
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.launch
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.core.Config
import space.yardstore.app.core.WebPages
import space.yardstore.app.core.stores.LocalSessionStore
import space.yardstore.app.designsystem.LocalYardWindow
import space.yardstore.app.designsystem.Motion
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardDisplayText
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardLogo
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardTabletPreviews
import space.yardstore.app.designsystem.YardWindow
import space.yardstore.app.designsystem.components.AdaptiveContent
import space.yardstore.app.designsystem.components.Card
import space.yardstore.app.designsystem.components.LocalBackAction
import space.yardstore.app.designsystem.components.LocalToastCenter
import space.yardstore.app.designsystem.components.Skeleton
import space.yardstore.app.designsystem.components.SkeletonShape
import space.yardstore.app.designsystem.components.Toast
import space.yardstore.app.designsystem.components.YardButton
import space.yardstore.app.designsystem.components.YardButtonSize
import space.yardstore.app.designsystem.components.YardButtonStyle
import space.yardstore.app.designsystem.components.YardTopBar
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.components.yardCard
import space.yardstore.app.designsystem.components.yardScreenBackground
import space.yardstore.app.designsystem.yard

/**
 * Sign in or join (presented as a sheet by `router.present(Route.SignIn)`, or pushed).
 * Mirrors SignInView.swift.
 *
 * - "Continue with Google" (and any other provider the server lists at GET /api/auth/providers)
 *   → Custom Tab at /api/auth/oauth/{provider}/app-start (PKCE) → yard://auth/complete →
 *   POST /api/auth/oauth/app-exchange ([AuthAppHandoff], see android/Docs/connect.md).
 *   After a social sign-in the shopper picks "I'm here to shop" / "I want to sell on Yard"
 *   (the website's /auth/complete choice).
 * - Email + password: POST /api/auth/sign-in (handles `verify_email`).
 * - Create account: POST /api/auth/sign-up → "check your email".
 * - "Email me a sign-in link": POST /api/auth/magic-link. "Forgot password?": POST /api/auth/password/forgot.
 * - On success: `session.didSignIn()`, then Welcome (first time on this device) or close.
 */
@Composable
fun SignInView() {
    val model: SignInModel = viewModel { SignInModel(savedState = createSavedStateHandle()) }
    SignInScreen(model)
}

@Composable
internal fun SignInScreen(model: SignInModel) {
    val session = LocalSessionStore.current
    val router = LocalRouter.current
    val toast = LocalToastCenter.current
    val back = LocalBackAction.current
    val context = LocalContext.current
    val haptics = LocalHapticFeedback.current
    val focusManager = LocalFocusManager.current
    val scope = rememberCoroutineScope()
    val isDark = Color.yard.isDark

    var showWelcome by rememberSaveable { mutableStateOf(false) }
    /** True from a successful sign-in until the sheet closes (hides the "already signed in" panel). */
    var justSignedIn by rememberSaveable { mutableStateOf(false) }
    /** After a social sign-in: "What brings you to Yard?" (shop / sell). */
    var showIntentChoice by rememberSaveable { mutableStateOf(false) }
    var signingOut by remember { mutableStateOf(false) }

    val nameFocus = remember { FocusRequester() }
    val emailFocus = remember { FocusRequester() }
    val passwordFocus = remember { FocusRequester() }
    val setFocus: (SignInModel.Field) -> Unit = { field ->
        runCatching {
            when (field) {
                SignInModel.Field.Name -> nameFocus.requestFocus()
                SignInModel.Field.Email -> emailFocus.requestFocus()
                SignInModel.Field.Password -> passwordFocus.requestFocus()
            }
        }
    }

    LaunchedEffect(Unit) { model.loadProviders() }

    fun close() {
        if (router.sheet != null) router.dismissSheet() else back?.perform() ?: router.pop()
    }

    /** The server says signed in: re-read the session, confirm a shopper is there, then go on. */
    suspend fun completeSignIn(social: Boolean) {
        focusManager.clearFocus()
        session.didSignIn()
        val shopper = session.shopper
        if (shopper == null) {
            model.reportUnconfirmedSignIn()
            return
        }
        justSignedIn = true
        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
        when {
            // The website asks a new social sign-in what brought them (so a brand isn't stuck in a
            // shopper account with no way to start selling).
            social && !shopper.demo -> showIntentChoice = true
            AuthOnboarding.onboarded -> close()
            else -> showWelcome = true
        }
    }

    fun submit() {
        scope.launch { if (model.submit(setFocus)) completeSignIn(social = false) }
    }

    // Social sign-in comes back through yard://auth/complete (MainActivity → AuthAppHandoff),
    // possibly after the process was restarted; this screen finishes it.
    DisposableEffect(Unit) {
        AuthAppHandoff.screenAppeared()
        onDispose { AuthAppHandoff.screenDisappeared() }
    }
    val handoffOutcome = AuthAppHandoff.outcome
    LaunchedEffect(handoffOutcome) {
        val outcome = AuthAppHandoff.consumeOutcome() ?: return@LaunchedEffect
        if (model.finishSocial(outcome)) completeSignIn(social = true)
    }

    AnimatedContent(
        targetState = showWelcome,
        transitionSpec = {
            (slideInHorizontally(Motion.spring()) { it } + fadeIn(Motion.fade()))
                .togetherWith(slideOutHorizontally(Motion.spring()) { -it / 4 } + fadeOut(Motion.fade()))
        },
        label = "sign-in-welcome",
        modifier = Modifier.fillMaxSize(),
    ) { welcome ->
        if (welcome) {
            // iOS pushes WelcomeView inside the sign-in NavigationStack; here it replaces the form
            // in place and closes sign-in when it finishes.
            val welcomeModel: WelcomeModel = viewModel { WelcomeModel() }
            WelcomeScreen(welcomeModel, onFinish = { close() })
            return@AnimatedContent
        }
        Column(Modifier.fillMaxSize().yardScreenBackground()) {
            YardTopBar(title = null)
            // Tablets / large windows: the form keeps a reading width, centred (the background
            // and the top bar stay full width).
            AdaptiveContent(Modifier.weight(1f), maxWidth = signInReadingWidth(LocalYardWindow.current)) {
                Column(
                    Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .imePadding()
                        .navigationBarsPadding()
                        .padding(horizontal = Spacing.gutter)
                        .padding(top = Spacing.s, bottom = Spacing.xxxl)
                        .animateContentSize(Motion.spring()),
                    verticalArrangement = Arrangement.spacedBy(Spacing.xl),
                ) {
                    val signedInPanel = session.isSignedIn && !justSignedIn
                    val sentTo = model.signUpSentTo
                    SignInHeader(
                        title = when {
                            showIntentChoice -> "You're signed in"
                            signedInPanel -> "You're signed in"
                            sentTo != null -> "Check your email"
                            model.mode == SignInModel.Mode.SignUp -> "Create your account"
                            else -> "Sign in or join"
                        },
                        body = when {
                            showIntentChoice -> "Your account is connected."
                            signedInPanel -> session.shopper?.let { s ->
                                val demo = if (s.demo) " This is the shared demo shopper account." else ""
                                "Signed in as ${s.name}, ${s.email}.$demo"
                            } ?: ""
                            else -> "One account for every brand: follow studios, save pieces, get drop alerts and track each brand's order from one place."
                        },
                        isDark = isDark,
                    )
                    when {
                        showIntentChoice -> SignInIntentChoice(
                            onShop = { if (AuthOnboarding.onboarded) close() else showWelcome = true },
                            onSell = { WebPages.open(context, Config.webUrl(SELL_ONBOARDING_PATH), darkTheme = isDark) },
                        )
                        signedInPanel -> Column(verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
                            YardButton("Continue") { close() }
                            YardButton("Sign out", style = YardButtonStyle.Secondary, isLoading = signingOut) {
                                scope.launch {
                                    signingOut = true
                                    session.signOut()
                                    signingOut = false
                                    toast.show("Signed out", Toast.Style.Info)
                                }
                            }
                        }
                        justSignedIn -> SignInStatusLine("Signed in. Taking you there now.")
                        sentTo != null -> SignUpSentPanel(sentTo) { model.backToSignIn() }
                        else -> {
                            SignInSocialSection(
                                model,
                                exchangingKey = AuthAppHandoff.exchangingKey,
                                onSocial = { button ->
                                    model.startSocial(button)?.let { url -> WebPages.open(context, url, darkTheme = isDark) }
                                },
                                onDemo = {
                                    scope.launch { if (model.signInDemo()) completeSignIn(social = false) }
                                },
                            )
                            SignInFormCard(model, nameFocus, emailFocus, passwordFocus, setFocus, onSubmit = { submit() })
                            AuthTextLink(
                                if (model.mode == SignInModel.Mode.SignUp) "I already have an account" else "Create an account",
                                modifier = Modifier.align(Alignment.CenterHorizontally),
                            ) {
                                model.toggleMode()
                                focusManager.clearFocus()
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Widest the sign-in column gets on wide windows (a comfortable reading / form width). */
internal val SIGN_IN_READING_WIDTH = 560.dp

/**
 * The sign-in column's max width: the full width on phones, otherwise the window's
 * `contentMaxWidth` capped at [SIGN_IN_READING_WIDTH].
 */
internal fun signInReadingWidth(window: YardWindow): Dp {
    val cap = window.contentMaxWidth
    if (!cap.isSpecified) return Dp.Unspecified
    return if (cap < SIGN_IN_READING_WIDTH) cap else SIGN_IN_READING_WIDTH
}

/** The website's seller application (opened in a Custom Tab from the shop / sell choice). */
internal const val SELL_ONBOARDING_PATH = "/studio/onboarding"

@Composable
private fun SignInHeader(title: String, body: String, isDark: Boolean) {
    Column(Modifier.padding(top = Spacing.s), verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
        YardLogo(
            Modifier.height(40.dp).widthIn(max = 110.dp).semantics { contentDescription = "Yard" },
            color = if (isDark) Color.yard.acid else Color.yard.ink,
        )
        YardDisplayText(title, size = 44.sp, modifier = Modifier.semantics { heading() })
        if (body.isNotEmpty()) Text(body, style = YardFonts.callout, color = Color.yard.ink2)
    }
}

@Composable
private fun SignInSocialSection(
    model: SignInModel,
    exchangingKey: String?,
    onSocial: (AuthSocialButton) -> Unit,
    onDemo: () -> Unit,
) {
    val buttons = model.socialButtons
    val showDemo = model.demoEnabled
    if (!model.providersLoaded) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
            Skeleton(Modifier.fillMaxWidth().height(YardButtonSize.Large.height), shape = SkeletonShape.Capsule)
            AuthDividerLabel("or with email")
        }
    } else if (buttons.isNotEmpty() || showDemo) {
        val busy = model.busy ?: exchangingKey?.let { SignInModel.Busy.Social(it) }
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
            if (showDemo) {
                YardButton(
                    "Continue as demo shopper",
                    style = YardButtonStyle.Secondary,
                    isLoading = busy == SignInModel.Busy.Demo,
                    enabled = busy == null || busy == SignInModel.Busy.Demo,
                    onClick = onDemo,
                )
            }
            for (button in buttons) {
                val mine = busy == SignInModel.Busy.Social(button.key)
                AuthSocialButtonView(button, isLoading = mine, enabled = busy == null || mine) { onSocial(button) }
            }
            AuthDividerLabel("or with email")
        }
    }
}

@Composable
private fun SignInFormCard(
    model: SignInModel,
    nameFocus: FocusRequester,
    emailFocus: FocusRequester,
    passwordFocus: FocusRequester,
    setFocus: (SignInModel.Field) -> Unit,
    onSubmit: () -> Unit,
) {
    val busy = model.busy
    val signUp = model.mode == SignInModel.Mode.SignUp
    Card(padding = Spacing.l) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.l)) {
            AnimatedVisibility(visible = signUp) {
                AuthTextField(
                    label = "Name",
                    value = model.name,
                    onValueChange = { model.name = it; model.revalidate(SignInModel.Field.Name) },
                    modifier = Modifier.focusRequester(nameFocus),
                    error = model.nameError,
                    capitalization = KeyboardCapitalization.Words,
                    onImeAction = { setFocus(SignInModel.Field.Email) },
                )
            }
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                AuthTextField(
                    label = "Email",
                    value = model.email,
                    onValueChange = { model.email = it; model.revalidate(SignInModel.Field.Email) },
                    modifier = Modifier.focusRequester(emailFocus),
                    error = model.emailError,
                    keyboardType = KeyboardType.Email,
                    onImeAction = { setFocus(SignInModel.Field.Password) },
                )
                if (!signUp && model.magicLinkEnabled) {
                    AuthTextLink(
                        if (busy == SignInModel.Busy.Magic) "Sending sign-in link…" else "Email me a sign-in link",
                        enabled = busy == null,
                    ) { model.requestMagicLink(setFocus) }
                }
            }
            AuthPasswordField(
                label = "Password",
                value = model.password,
                onValueChange = { model.password = it; model.revalidate(SignInModel.Field.Password) },
                isRevealed = model.isPasswordRevealed,
                onRevealedChange = { model.isPasswordRevealed = it },
                modifier = Modifier.focusRequester(passwordFocus),
                error = model.passwordError,
                imeAction = ImeAction.Go,
                onImeAction = onSubmit,
            )
            val submitting = busy == SignInModel.Busy.Email || busy == SignInModel.Busy.SignUp
            YardButton(
                if (signUp) "Create account" else "Sign in",
                isLoading = submitting,
                enabled = busy == null || submitting,
                onClick = onSubmit,
            )
            if (!signUp) {
                AuthTextLink(
                    if (busy == SignInModel.Busy.Forgot) "Sending reset link…" else "Forgot password?",
                    modifier = Modifier.align(Alignment.CenterHorizontally),
                    enabled = busy == null,
                ) { model.requestPasswordReset(setFocus) }
            }
            model.failure?.let { SignInMessageLine(it, Icons.Outlined.ErrorOutline, Color.yard.danger) }
            model.notice?.let { SignInMessageLine(it, Icons.Outlined.MailOutline, Color.yard.ink2) }
            if (model.demoEnabled) {
                Text(
                    "Demo sign-in uses the shared shopper account; email sign-in creates or opens your own account.",
                    style = YardFonts.caption,
                    color = Color.yard.ink3,
                )
            }
        }
    }
}

@Composable
private fun SignInMessageLine(text: String, icon: androidx.compose.ui.graphics.vector.ImageVector, color: Color) {
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s), verticalAlignment = Alignment.Top) {
        Icon(icon, contentDescription = null, tint = color, modifier = Modifier.padding(top = 2.dp).size(18.dp))
        Text(text, style = YardFonts.callout, color = color)
    }
}

@Composable
private fun SignUpSentPanel(email: String, onBack: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.l)) {
        Card {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.m), verticalAlignment = Alignment.Top) {
                Box(
                    Modifier.size(40.dp).yardCard(Color.yard.acid, radius = 10.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Outlined.MarkEmailUnread, contentDescription = null, tint = Color.yard.onAcid, modifier = Modifier.size(22.dp))
                }
                Text(
                    "We sent a verification link to $email. Open it to finish creating your account.",
                    style = YardFonts.body,
                    color = Color.yard.ink,
                )
            }
        }
        YardButton("Back to sign in", style = YardButtonStyle.Secondary, onClick = onBack)
    }
}

@Composable
private fun SignInStatusLine(text: String) {
    Row(
        Modifier.fillMaxWidth().yardCard().padding(Spacing.l),
        horizontalArrangement = Arrangement.spacedBy(Spacing.s),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CircularProgressIndicator(color = Color.yard.ink, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
        Text(text, style = YardFonts.callout, color = Color.yard.ink2)
    }
}

/**
 * The website's choice after a social sign-in (auth-oauth-completion.tsx): "What brings you to
 * Yard?" — shop (Welcome or close) or sell (the seller application in a Custom Tab).
 */
@Composable
private fun SignInIntentChoice(onShop: () -> Unit, onSell: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
        Text("What brings you to Yard?", style = YardFonts.callout, color = Color.yard.ink)
        SignInIntentCard(
            title = "I’m here to shop",
            body = "Discover independent brands, follow them and catch their drops.",
            onClick = onShop,
        )
        SignInIntentCard(
            title = "I want to sell on Yard",
            body = "Apply with your brand, set up your storefront and start selling. You can still shop with this account.",
            onClick = onSell,
        )
    }
}

@Composable
private fun SignInIntentCard(title: String, body: String, onClick: () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .yardCard()
            .pressableClick(onClickLabel = title, onClick = onClick)
            .padding(Spacing.l),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(title, style = YardFonts.headline, color = Color.yard.ink)
        Text(body, style = YardFonts.callout, color = Color.yard.ink2)
    }
}

// region Previews

@Preview(name = "SignInView — dark")
@Composable
private fun SignInDarkPreview() = YardPreview(darkTheme = true, signedIn = false) {
    SignInScreen(remember { SignInModel(previewProviders = AuthProviders.preview()) })
}

@Preview(name = "SignInView — light")
@Composable
private fun SignInLightPreview() = YardPreview(darkTheme = false, signedIn = false) {
    SignInScreen(remember { SignInModel(previewProviders = AuthProviders.preview(demoShopper = true)) })
}

@Preview(name = "SignInView signed in — dark")
@Composable
private fun SignInSignedInPreview() = YardPreview(darkTheme = true, signedIn = true) {
    SignInScreen(remember { SignInModel(previewProviders = AuthProviders.preview()) })
}

@YardTabletPreviews
@Composable
private fun SignInTabletPreview() = YardPreview(darkTheme = true, signedIn = false) {
    SignInScreen(remember { SignInModel(previewProviders = AuthProviders.preview(demoShopper = true)) })
}

@Preview(name = "Shop or sell — light")
@Composable
private fun SignInIntentPreview() = YardPreview(darkTheme = false) {
    Column(Modifier.padding(Spacing.gutter)) { SignInIntentChoice(onShop = {}, onSell = {}) }
}

// endregion
