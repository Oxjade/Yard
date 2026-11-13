package space.yardstore.app.features.you

import androidx.compose.foundation.background
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.key
import androidx.compose.runtime.saveable.rememberSaveable
import space.yardstore.app.designsystem.LocalYardWindow
import space.yardstore.app.designsystem.YardTabletPreviews
import space.yardstore.app.designsystem.components.EmptyState
import space.yardstore.app.designsystem.components.ListDetailLayout
import space.yardstore.app.designsystem.components.LocalBackAction
import space.yardstore.app.designsystem.components.adaptiveContentWidth
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.HelpOutline
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Badge
import androidx.compose.material.icons.outlined.Contrast
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.HourglassEmpty
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Paid
import androidx.compose.material.icons.outlined.PhoneIphone
import androidx.compose.material.icons.outlined.Place
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.SheetValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import space.yardstore.app.app.AppTab
import space.yardstore.app.app.LegalPage
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.app.Route
import space.yardstore.app.core.AppearancePreference
import space.yardstore.app.core.Config
import space.yardstore.app.core.Formatters
import space.yardstore.app.core.models.YardDate
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.core.networking.HTTPMethod
import space.yardstore.app.core.stores.LocalAppearanceStore
import space.yardstore.app.core.stores.LocalCartStore
import space.yardstore.app.core.stores.LocalSessionStore
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardDisplayText
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.components.Card
import space.yardstore.app.designsystem.components.LocalToastCenter
import space.yardstore.app.designsystem.components.SettingsRow
import space.yardstore.app.designsystem.components.Toast
import space.yardstore.app.designsystem.components.ToastCenter
import space.yardstore.app.designsystem.components.YardButton
import space.yardstore.app.designsystem.components.YardButtonSize
import space.yardstore.app.designsystem.components.YardSheet
import space.yardstore.app.designsystem.components.YardSheetHeader
import space.yardstore.app.designsystem.components.YardToastHost
import space.yardstore.app.designsystem.components.YardTopBar
import space.yardstore.app.designsystem.components.yardScreenBackground
import space.yardstore.app.designsystem.yard

// You › Settings, in the style of reference 08 (grouped rounded cards, icon tile per row).
// Mirrors SettingsView.swift.
//   General: Appearance, Notifications, Ship to, Currency
//   Account: Your details, Addresses, Password, Delete account; Sign-in methods
//            (GET /api/auth/security?as=shopper, DELETE /api/auth/identities/{id}?as=shopper)
//   Help and legal: Help, Terms, Privacy, Refunds, Data deletion; Sign out

class YouSecurityModel(
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
    var security by mutableStateOf<YouSecurity?>(null); private set
    var unlinkingId by mutableStateOf<String?>(null); private set

    fun load() = viewModelScope.launch { fetch() }

    suspend fun fetch() {
        if (security == null) phase = Phase.Loading
        try {
            security = api.get<YouSecurity>("$root/api/auth/security", youAsShopper)
            phase = Phase.Loaded
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (e is APIError && e.isCancelled) return
            if (security == null) phase = Phase.Failed(APIError.messageFor(e))
        }
    }

    fun reset() {
        security = null
        phase = Phase.Idle
    }

    /** DELETE /api/auth/identities/{id}?as=shopper (422 when it's the only way left to sign in). */
    fun unlink(identity: YouIdentity, toast: ToastCenter) = viewModelScope.launch { unlinkNow(identity, toast) }

    suspend fun unlinkNow(identity: YouIdentity, toast: ToastCenter) {
        unlinkingId = identity.id
        try {
            api.send(HTTPMethod.DELETE, "$root/api/auth/identities/${Config.encodePath(identity.id)}", query = youAsShopper)
            toast.show("${identity.providerName} disconnected.", Toast.Style.Success)
            fetch()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            toast.show(e)
        } finally {
            unlinkingId = null
        }
    }
}

@Composable
fun SettingsView() {
    val session = LocalSessionStore.current
    val cart = LocalCartStore.current
    val router = LocalRouter.current
    val toast = LocalToastCenter.current
    val context = LocalContext.current
    val dark = Color.yard.isDark
    val scope = rememberCoroutineScope()
    val appearanceStore = LocalAppearanceStore.current
    val appearanceFlow = remember(appearanceStore) { appearanceStore?.preference ?: flowOf(AppearancePreference.SYSTEM) }
    val appearance by appearanceFlow.collectAsState(AppearancePreference.SYSTEM)

    val security: YouSecurityModel = viewModel { YouSecurityModel() }
    var regionSheet by remember { mutableStateOf<YouRegionSheetMode?>(null) }
    var showsDetails by remember { mutableStateOf(false) }
    var showsPassword by remember { mutableStateOf(false) }
    var showsDelete by remember { mutableStateOf(false) }
    var pendingUnlink by remember { mutableStateOf<YouIdentity?>(null) }
    var isSigningOut by remember { mutableStateOf(false) }
    var shipTo by remember { mutableStateOf(YouRegion.storedShipTo) }

    LaunchedEffect(session.shopper?.id) {
        YouRegion.restore(cart)
        if (session.isSignedIn) security.load() else security.reset()
    }

    fun signOut() {
        if (isSigningOut) return
        isSigningOut = true
        scope.launch {
            session.signOut()
            isSigningOut = false
            security.reset()
            toast.show("Signed out", Toast.Style.Info, icon = Icons.AutoMirrored.Outlined.Logout)
            router.popToRoot(AppTab.You)
        }
    }

    // Expanded windows: settings list on the left, the selected sub-page on the right
    // (AGENTS › Tablet rule 3). Otherwise sub-pages are pushed as on phones.
    val twoPane = LocalYardWindow.current.isExpanded
    var selectedPage by rememberSaveable { mutableStateOf<YouSettingsPage?>(null) }
    fun open(page: YouSettingsPage) {
        if (twoPane) selectedPage = page else router.push(page.route)
    }
    @Composable
    fun Modifier.pageRow(page: YouSettingsPage): Modifier =
        youRowClick { open(page) }.youSelectedRow(twoPane && selectedPage == page)

    ListDetailLayout(
        twoPane = twoPane,
        list = {
            Column(Modifier.fillMaxSize().yardScreenBackground()) {
                YardTopBar("Settings")
                Column(
                    Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .navigationBarsPadding(),
                ) {
                    Column(
                        Modifier
                            .adaptiveContentWidth()
                            .padding(horizontal = Spacing.gutter)
                            .padding(top = Spacing.m, bottom = Spacing.xxl),
                        verticalArrangement = Arrangement.spacedBy(Spacing.xl),
                    ) {
                        // General
                        YouSettingsGroup("General") {
                            SettingsRow("Appearance", Icons.Outlined.Contrast, Modifier.pageRow(YouSettingsPage.Appearance), value = appearance.title)
                            SettingsRow("Notifications", Icons.Outlined.Notifications, Modifier.pageRow(YouSettingsPage.Notifications))
                            SettingsRow(
                                "Ship to", Icons.Outlined.Inventory2,
                                Modifier.youRowClick { regionSheet = YouRegionSheetMode.Country },
                                value = YouMarkets.country(shipTo)?.name ?: "Not set",
                            )
                            SettingsRow(
                                "Currency", Icons.Outlined.Paid,
                                Modifier.youRowClick { regionSheet = YouRegionSheetMode.Currency },
                                value = YouMarkets.currency(cart.currency)?.label ?: cart.currency,
                            )
                        }

                        if (session.isSignedIn) {
                            SettingsAccount(
                                model = security,
                                shopperName = session.shopper?.name,
                                onDetails = { showsDetails = true },
                                addressesModifier = Modifier.pageRow(YouSettingsPage.Addresses),
                                onPassword = { showsPassword = true },
                                onDelete = { showsDelete = true },
                                onUnlink = { pendingUnlink = it },
                                onConnectOnWeb = { YouWebPage.WebSettings.open(context, dark) },
                            )
                        } else if (session.hasLoaded) {
                            Card {
                                Column(verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
                                    YardDisplayText("Settings", size = 28.sp)
                                    Text(
                                        "Sign in to change your details, the notifications you get, where you ship to and what you're into.",
                                        style = YardFonts.callout,
                                        color = Color.yard.ink2,
                                    )
                                    YardButton("Sign in", size = YardButtonSize.Medium) { router.present(Route.SignIn) }
                                }
                            }
                        }

                        // Help and legal
                        YouSettingsGroup("Help and legal") {
                            SettingsRow("Help", Icons.AutoMirrored.Outlined.HelpOutline, Modifier.youRowClick { YouWebPage.Help.open(context, dark) })
                            LegalPage.entries.forEach { page ->
                                SettingsRow(page.title, YouLegalIcon.icon(page), Modifier.pageRow(YouSettingsPage.legal(page)))
                            }
                        }

                        if (session.isSignedIn) {
                            YouSettingsGroup(null, footer = "Sign out of Yard on this phone. Your bag stays here for next time.") {
                                SettingsRow(
                                    "Sign out", Icons.AutoMirrored.Outlined.Logout,
                                    Modifier.youRowClick(enabled = !isSigningOut) { signOut() },
                                    tint = Color.yard.danger,
                                    showsChevron = false,
                                    accessory = if (isSigningOut) ({ YouSpinner() }) else null,
                                )
                            }
                        }
                    }
                }
            }
        },
        detail = { YouSettingsDetail(selectedPage) },
    )

    regionSheet?.let { mode ->
        YouRegionSheet(mode = mode, onChange = { shipTo = YouRegion.storedShipTo }, onDismiss = { regionSheet = null })
    }
    if (showsDetails) {
        YouAccountDetailsSheet(
            security = security.security,
            onHelp = {
                scope.launch {
                    delay(300) // let the sheet finish closing first
                    YouWebPage.Help.open(context, dark)
                }
            },
            onDismiss = { showsDetails = false },
        )
    }
    if (showsPassword) {
        YouChangePasswordSheet(
            hasPassword = security.security?.hasPassword ?: true,
            onChanged = { security.load() },
            onDismiss = { showsPassword = false },
        )
    }
    if (showsDelete) {
        YouDeleteAccountSheet(
            security = security.security,
            // Runs in this screen's scope: the sheet's own scope ends as soon as it closes.
            onDeleted = {
                scope.launch {
                    session.refresh()
                    router.popToRoot(AppTab.You)
                    toast.show("Your account is being deleted. Every session has ended.", Toast.Style.Info)
                }
            },
            onDismiss = { showsDelete = false },
        )
    }
    pendingUnlink?.let { identity ->
        AlertDialog(
            onDismissRequest = { pendingUnlink = null },
            containerColor = Color.yard.surface,
            titleContentColor = Color.yard.ink,
            textContentColor = Color.yard.ink2,
            title = { Text("Disconnect ${identity.providerName}?", style = YardFonts.headline) },
            text = { Text("You won't be able to sign in with ${identity.providerName} until you connect it again.", style = YardFonts.callout) },
            confirmButton = {
                TextButton(onClick = {
                    pendingUnlink = null
                    security.unlink(identity, toast)
                }) { Text("Disconnect", style = YardFonts.bodyEmphasis, color = Color.yard.danger) }
            },
            dismissButton = {
                TextButton(onClick = { pendingUnlink = null }) { Text("Cancel", style = YardFonts.body, color = Color.yard.ink) }
            },
        )
    }
}

@Composable
private fun SettingsAccount(
    model: YouSecurityModel,
    shopperName: String?,
    onDetails: () -> Unit,
    addressesModifier: Modifier,
    onPassword: () -> Unit,
    onDelete: () -> Unit,
    onUnlink: (YouIdentity) -> Unit,
    onConnectOnWeb: () -> Unit,
) {
    val s = model.security
    YouSettingsGroup("Account", footer = "Your name goes on your orders.") {
        SettingsRow("Your details", Icons.Outlined.Badge, Modifier.youRowClick(onClick = onDetails), value = shopperName)
        SettingsRow("Addresses", Icons.Outlined.Place, addressesModifier)
        when (model.phase) {
            YouSecurityModel.Phase.Idle, YouSecurityModel.Phase.Loading -> YouSkeletonRow()
            is YouSecurityModel.Phase.Failed -> SettingsRow(
                "Couldn't load sign-in settings", Icons.Outlined.WarningAmber,
                Modifier.youRowClick { model.load() },
                value = "Retry",
                showsChevron = false,
            )
            YouSecurityModel.Phase.Loaded -> if (s != null && !s.demo) {
                SettingsRow(if (s.hasPassword) "Change password" else "Set a password", Icons.Outlined.Key, Modifier.youRowClick(onClick = onPassword))
            }
        }
        if (s != null && s.isDeletionPending) {
            SettingsRow("Deletion requested", Icons.Outlined.HourglassEmpty, value = youDeletionValue(s), tint = Color.yard.danger, showsChevron = false)
        } else {
            SettingsRow("Delete account", Icons.Outlined.Delete, Modifier.youRowClick(enabled = s != null, onClick = onDelete), tint = Color.yard.danger)
        }
    }

    if (s != null) {
        YouSettingsGroup("Sign-in methods", footer = youMethodsFooter(s)) {
            SettingsRow("Email and password", Icons.Outlined.Email, value = if (s.hasPassword) "On" else "Not set", showsChevron = false)
            s.identities.forEach { identity ->
                SettingsRow(identity.providerName, identity.icon, value = identity.email ?: "Connected", showsChevron = false) {
                    if (model.unlinkingId == identity.id) {
                        YouSpinner()
                    } else {
                        TextButton(onClick = { onUnlink(identity) }) {
                            Text("Disconnect", style = YardFonts.captionEmphasis, color = Color.yard.danger)
                        }
                    }
                }
            }
            if (s.providers.google && s.identities.none { it.provider == "google" } && !s.demo) {
                SettingsRow("Google", Icons.Outlined.AccountCircle, Modifier.youRowClick(onClick = onConnectOnWeb), value = "Connect on the web")
            }
            if (s.providers.apple && s.identities.none { it.provider == "apple" } && !s.demo) {
                SettingsRow("Apple", Icons.Outlined.PhoneIphone, Modifier.youRowClick(onClick = onConnectOnWeb), value = "Connect on the web")
            }
        }
    }
}

private fun youMethodsFooter(s: YouSecurity): String =
    if (s.demo) "This is a demo account. It has no password and can't use Google or Apple sign-in."
    else "Connecting Google or Apple happens on yardstore.space, signed in to this account. Keep at least one way to sign in."

private fun youDeletionValue(s: YouSecurity): String {
    val date = YardDate.parse(s.deletion?.requestedAt) ?: return "Pending"
    return Formatters.relative(date)
}

// MARK: - Two-pane detail (Expanded windows)

/** A Settings sub-page: pushed as [route] on phones, shown in the detail pane on Expanded windows. */
enum class YouSettingsPage {
    Appearance, Notifications, Addresses, Terms, Privacy, Refunds, DataDeletion;

    val route: Route
        get() = when (this) {
            Appearance -> Route.Appearance
            Notifications -> Route.NotificationSettings
            Addresses -> Route.Addresses
            Terms -> Route.Legal(LegalPage.Terms)
            Privacy -> Route.Legal(LegalPage.Privacy)
            Refunds -> Route.Legal(LegalPage.Refunds)
            DataDeletion -> Route.Legal(LegalPage.DataDeletion)
        }

    companion object {
        fun legal(page: LegalPage): YouSettingsPage = when (page) {
            LegalPage.Terms -> Terms
            LegalPage.Privacy -> Privacy
            LegalPage.Refunds -> Refunds
            LegalPage.DataDeletion -> DataDeletion
        }
    }
}

/** The detail pane: the selected sub-page without a back button, or an honest empty state. */
@Composable
private fun YouSettingsDetail(page: YouSettingsPage?) {
    CompositionLocalProvider(LocalBackAction provides null) {
        key(page) {
            when (page) {
                null -> Column(Modifier.fillMaxSize().yardScreenBackground()) {
                    YardTopBar(null)
                    EmptyState(
                        title = "Pick a setting",
                        message = "Choose something on the left to see it here.",
                        icon = Icons.Outlined.Settings,
                        modifier = Modifier.weight(1f),
                    )
                }
                YouSettingsPage.Appearance -> AppearanceView()
                YouSettingsPage.Notifications -> NotificationSettingsView()
                YouSettingsPage.Addresses -> AddressesView()
                YouSettingsPage.Terms -> LegalView(LegalPage.Terms)
                YouSettingsPage.Privacy -> LegalView(LegalPage.Privacy)
                YouSettingsPage.Refunds -> LegalView(LegalPage.Refunds)
                YouSettingsPage.DataDeletion -> LegalView(LegalPage.DataDeletion)
            }
        }
    }
}

/** Marks the row whose page shows in the detail pane (two-pane Settings). */
@Composable
private fun Modifier.youSelectedRow(isSelected: Boolean): Modifier =
    if (!isSelected) this else this.semantics { selected = true }.background(Color.yard.surface2)

/** Small inline progress spinner for row accessories (iOS `ProgressView().tint(ink2)`). */
@Composable
internal fun YouSpinner() {
    CircularProgressIndicator(color = Color.yard.ink2, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
}

// MARK: - Sheet scaffold

/**
 * A YardSheet that can close itself with the hide animation (iOS `dismiss()`), hosts toasts
 * (iOS `.yardToastHost(toast)`) and can refuse to be dismissed (iOS `.interactiveDismissDisabled`).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun YouSheet(
    onDismiss: () -> Unit,
    skipPartiallyExpanded: Boolean = true,
    /** Tall, screen-like sheets show as a centered dialog on wide windows (AGENTS › Tablet rule 7). */
    presentAsDialogOnWide: Boolean = false,
    canDismiss: () -> Boolean = { true },
    content: @Composable ColumnScope.(close: () -> Unit) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val canDismissNow by rememberUpdatedState(canDismiss)
    val state = rememberModalBottomSheetState(
        skipPartiallyExpanded = skipPartiallyExpanded,
        confirmValueChange = { it != SheetValue.Hidden || canDismissNow() },
    )
    val asDialog = presentAsDialogOnWide && LocalYardWindow.current.sheetIsDialog
    val close: () -> Unit = {
        // The dialog form has no sheet state to animate; it just goes.
        if (asDialog) onDismiss() else scope.launch { state.hide() }.invokeOnCompletion { onDismiss() }
    }
    YardSheet(
        onDismissRequest = { if (canDismissNow()) onDismiss() },
        skipPartiallyExpanded = skipPartiallyExpanded,
        sheetState = state,
        presentAsDialogOnWide = presentAsDialogOnWide,
    ) {
        YardToastHost(LocalToastCenter.current) {
            Column(Modifier.fillMaxWidth()) { content(close) }
        }
    }
}

// MARK: - Ship to / currency

enum class YouRegionSheetMode { Country, Currency }

/** Pick the ship-to country or the display currency (src/components/market/locale-select.tsx). */
@Composable
fun YouRegionSheet(mode: YouRegionSheetMode, onChange: () -> Unit, onDismiss: () -> Unit) {
    val cart = LocalCartStore.current
    val haptics = LocalHapticFeedback.current
    var selected by remember { mutableStateOf<String?>(null) }
    var isSaving by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    YouSheet(onDismiss = onDismiss, presentAsDialogOnWide = true, canDismiss = { !isSaving }) { close ->
        YardSheetHeader(
            if (mode == YouRegionSheetMode.Country) "Ship to" else "Currency",
            subtitle = if (mode == YouRegionSheetMode.Country)
                "Sets delivery times and shipping costs. The currency follows the country unless you pick one."
            else
                "Prices show in your currency as an estimate; checkout confirms the rate.",
            onClose = close,
        )
        Column(
            Modifier
                .verticalScroll(rememberScrollState())
                .padding(horizontal = Spacing.gutter)
                .padding(bottom = Spacing.xl)
                .navigationBarsPadding(),
        ) {
            Card(padding = Spacing.xs) {
                fun choose(code: String, block: suspend () -> Unit) {
                    if (isSaving) return
                    selected = code
                    isSaving = true
                    haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
                    scope.launch {
                        try { block() } finally {
                            isSaving = false
                            onChange()
                            close()
                        }
                    }
                }
                when (mode) {
                    YouRegionSheetMode.Country -> YouMarkets.countries.forEach { c ->
                        YouRegionRow(c.name, c.currency, (selected ?: YouRegion.storedShipTo) == c.code, !isSaving) {
                            choose(c.code) { YouRegion.setShipTo(c, cart) }
                        }
                    }
                    YouRegionSheetMode.Currency -> YouMarkets.currencies.forEach { c ->
                        YouRegionRow(c.code, c.symbol, (selected ?: cart.currency) == c.code, !isSaving) {
                            choose(c.code) { YouRegion.setCurrency(c, cart) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun YouRegionRow(title: String, value: String, isSelected: Boolean, enabled: Boolean, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .youRowClick(enabled = enabled, onClick = onClick)
            .semantics { selected = isSelected }
            .heightIn(min = 48.dp)
            .padding(horizontal = Spacing.m),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
    ) {
        Text(title, style = YardFonts.body, color = Color.yard.ink, modifier = Modifier.weight(1f))
        Text(value, style = YardFonts.callout, color = Color.yard.ink3)
        Icon(
            Icons.Filled.Check, contentDescription = null,
            tint = if (isSelected) Color.yard.ink else Color.Transparent,
            modifier = Modifier.size(18.dp),
        )
    }
}

@Preview(name = "SettingsView — dark")
@Composable
private fun SettingsViewDark() = YardPreview(darkTheme = true) { SettingsView() }

@Preview(name = "SettingsView — light")
@Composable
private fun SettingsViewLight() = YardPreview(darkTheme = false, signedIn = false) { SettingsView() }

@YardTabletPreviews
@Composable
private fun SettingsViewTablet() = YardPreview(darkTheme = true) { SettingsView() }
