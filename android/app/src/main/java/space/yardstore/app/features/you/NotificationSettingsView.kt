package space.yardstore.app.features.you

import android.content.Intent
import android.provider.Settings
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.MarkChatRead
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material.icons.outlined.PhoneAndroid
import androidx.compose.material.icons.outlined.Sell
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.app.Route
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.core.stores.LocalFollowStore
import space.yardstore.app.core.stores.LocalSessionStore
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.components.Card
import space.yardstore.app.designsystem.components.EmptyState
import space.yardstore.app.designsystem.components.LocalToastCenter
import space.yardstore.app.designsystem.components.SettingsRow
import space.yardstore.app.designsystem.components.Toast
import space.yardstore.app.designsystem.components.ToastCenter
import space.yardstore.app.designsystem.components.YardTopBar
import space.yardstore.app.designsystem.components.yardScreenBackground
import space.yardstore.app.designsystem.yard

// You › Settings › Notifications. Mirrors NotificationSettingsView.swift (and the website's
// src/components/market/account/settings-view.tsx):
//   GET/PATCH /api/notifications/preferences?as=shopper  { preferences: { email: {…}, inApp: {…} } }
//   categories: drops, price_drops, back_in_stock, brand_news
//   GET/PATCH /api/inbox/settings { readReceipts }
// Each switch saves at once; a topic writes its email flag only while Email is on, so switching a
// topic on never restarts email the shopper turned off. Email off stops every topic's email.

/** One set of optional-category flags. All optional so a PATCH only sends what changed. */
@Serializable
data class YouPrefFlags(
    val drops: Boolean? = null,
    @SerialName("price_drops") val priceDrops: Boolean? = null,
    @SerialName("back_in_stock") val backInStock: Boolean? = null,
    @SerialName("brand_news") val brandNews: Boolean? = null,
) {
    val anyOn: Boolean get() = drops == true || priceDrops == true || backInStock == true || brandNews == true

    /** `other`'s set flags win (iOS `merged`). */
    fun merged(other: YouPrefFlags): YouPrefFlags = YouPrefFlags(
        drops = other.drops ?: drops,
        priceDrops = other.priceDrops ?: priceDrops,
        backInStock = other.backInStock ?: backInStock,
        brandNews = other.brandNews ?: brandNews,
    )
}

@Serializable
data class YouPreferences(val email: YouPrefFlags = YouPrefFlags(), val inApp: YouPrefFlags = YouPrefFlags())

@Serializable
internal data class YouPreferencesResponse(val preferences: YouPreferences = YouPreferences())

@Serializable
internal data class YouPreferencesPatch(val email: YouPrefFlags? = null, val inApp: YouPrefFlags? = null)

@Serializable
internal data class YouInboxSettings(val readReceipts: Boolean = true)

/** The topics a shopper can switch, each one server category. */
enum class YouNotifyTopic(val title: String, val detail: String, val icon: ImageVector) {
    Drops("Drops", "Announcements from brands you follow, and the reminders you set with Notify me.", Icons.Outlined.Bolt),
    BrandNews("New products and collections", "When a brand you follow adds new pieces or a new collection.", Icons.Outlined.AutoAwesome),
    PriceDrops("Promotions", "Sales and offers from brands you follow. Never from brands you don't.", Icons.Outlined.Sell),
    BackInStock("Back in stock", "When a piece you saved is available again.", Icons.Outlined.Inventory2);

    fun value(flags: YouPrefFlags): Boolean = when (this) {
        Drops -> flags.drops ?: false
        BrandNews -> flags.brandNews ?: false
        PriceDrops -> flags.priceDrops ?: false
        BackInStock -> flags.backInStock ?: false
    }

    fun flags(value: Boolean): YouPrefFlags = when (this) {
        Drops -> YouPrefFlags(drops = value)
        BrandNews -> YouPrefFlags(brandNews = value)
        PriceDrops -> YouPrefFlags(priceDrops = value)
        BackInStock -> YouPrefFlags(backInStock = value)
    }
}

class YouNotificationsModel(
    private val api: APIClient = APIClient.shared,
    /** URL prefix for the API paths ("" = the configured base URL; tests point it at a mock server). */
    private val root: String = "",
) : ViewModel() {
    sealed interface Phase {
        data object Loading : Phase
        data object Loaded : Phase
        data class Failed(val message: String) : Phase
    }

    var phase by mutableStateOf<Phase>(Phase.Loading); private set
    var prefs by mutableStateOf(YouPreferences()); private set
    var readReceipts by mutableStateOf<Boolean?>(null); private set
    var isSaving by mutableStateOf(false); private set
    /** "Drops off. Saved." under the list, like the website's quiet note. */
    var lastChange by mutableStateOf<String?>(null); private set

    /** Email reads on while any topic still sends email. */
    val emailOn: Boolean get() = prefs.email.anyOn

    fun load() = viewModelScope.launch { fetch() }

    suspend fun fetch() {
        if (phase != Phase.Loaded) phase = Phase.Loading
        try {
            prefs = api.get<YouPreferencesResponse>("$root/api/notifications/preferences", youAsShopper).preferences
            phase = Phase.Loaded
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (e is APIError && e.isCancelled) return
            phase = Phase.Failed(APIError.messageFor(e))
            return
        }
        // Read receipts are a separate inbox setting; a failure here only hides that row.
        readReceipts = try {
            api.get<YouInboxSettings>("$root/api/inbox/settings").readReceipts
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            null
        }
    }

    fun setTopic(topic: YouNotifyTopic, value: Boolean, toast: ToastCenter) = viewModelScope.launch { setTopicNow(topic, value, toast) }

    suspend fun setTopicNow(topic: YouNotifyTopic, value: Boolean, toast: ToastCenter) {
        val before = prefs
        val patch = YouPreferencesPatch(email = if (emailOn) topic.flags(value) else null, inApp = topic.flags(value))
        apply(patch)
        save(patch, before, "${topic.title} ${if (value) "on" else "off"}. Saved.", toast)
    }

    fun setEmail(value: Boolean, toast: ToastCenter) = viewModelScope.launch { setEmailNow(value, toast) }

    suspend fun setEmailNow(value: Boolean, toast: ToastCenter) {
        val before = prefs
        val email = if (value) YouPrefFlags(
            drops = prefs.inApp.drops ?: false,
            priceDrops = prefs.inApp.priceDrops ?: false,
            backInStock = prefs.inApp.backInStock ?: true,
            brandNews = prefs.inApp.brandNews ?: false,
        ) else YouPrefFlags(drops = false, priceDrops = false, backInStock = false, brandNews = false)
        val patch = YouPreferencesPatch(email = email)
        apply(patch)
        save(patch, before, "Email notifications ${if (value) "on" else "off"}. Saved.", toast)
    }

    fun setReadReceipts(value: Boolean, toast: ToastCenter) = viewModelScope.launch { setReadReceiptsNow(value, toast) }

    suspend fun setReadReceiptsNow(value: Boolean, toast: ToastCenter) {
        val before = readReceipts
        readReceipts = value
        try {
            readReceipts = api.patch<YouInboxSettings>("$root/api/inbox/settings", body = YouInboxSettings(value)).readReceipts
            lastChange = "Read receipts ${if (value) "on" else "off"}. Saved."
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            readReceipts = before
            toast.show(e)
        }
    }

    private fun apply(patch: YouPreferencesPatch) {
        prefs = YouPreferences(
            email = patch.email?.let { prefs.email.merged(it) } ?: prefs.email,
            inApp = patch.inApp?.let { prefs.inApp.merged(it) } ?: prefs.inApp,
        )
    }

    private suspend fun save(patch: YouPreferencesPatch, rollback: YouPreferences, note: String, toast: ToastCenter) {
        isSaving = true
        try {
            prefs = api.patch<YouPreferencesResponse>("$root/api/notifications/preferences", body = patch, query = youAsShopper).preferences
            lastChange = note
        } catch (e: CancellationException) {
            prefs = rollback
            throw e
        } catch (e: Exception) {
            prefs = rollback
            if (e is APIError && e.isCancelled) return
            toast.show("Notification settings weren't saved. Try again.", Toast.Style.Error)
        } finally {
            isSaving = false
        }
    }
}

@Composable
fun NotificationSettingsView() {
    val session = LocalSessionStore.current
    val router = LocalRouter.current
    val model: YouNotificationsModel = viewModel { YouNotificationsModel() }

    LaunchedEffect(session.shopper?.id) {
        if (session.isSignedIn) model.load()
    }

    Column(Modifier.fillMaxSize().yardScreenBackground()) {
        YardTopBar("Notifications")
        if (!session.isSignedIn) {
            EmptyState.SignedOut(message = "Sign in to choose what you hear about from the brands you follow.") {
                router.present(Route.SignIn)
            }
        } else {
            when (val phase = model.phase) {
                YouNotificationsModel.Phase.Loading -> Column(
                    Modifier
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = Spacing.gutter)
                        .padding(top = Spacing.m),
                    verticalArrangement = Arrangement.spacedBy(Spacing.xl),
                ) {
                    YouSettingsGroup("Tell me about") { repeat(4) { YouSkeletonRow() } }
                    YouSettingsGroup("Send them by") { YouSkeletonRow() }
                }
                is YouNotificationsModel.Phase.Failed -> EmptyState.Error(message = phase.message) { model.fetch() }
                YouNotificationsModel.Phase.Loaded -> NotificationSettingsLoaded(model)
            }
        }
    }
}

@Composable
private fun NotificationSettingsLoaded(model: YouNotificationsModel) {
    val session = LocalSessionStore.current
    val follows = LocalFollowStore.current
    val toast = LocalToastCenter.current
    val context = LocalContext.current
    val haptics = LocalHapticFeedback.current
    var isFirstPrefs by remember { mutableStateOf(true) }
    LaunchedEffect(model.prefs) {
        if (isFirstPrefs) isFirstPrefs = false else haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
    }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .navigationBarsPadding()
            .padding(horizontal = Spacing.gutter)
            .padding(top = Spacing.m, bottom = Spacing.xxl),
        verticalArrangement = Arrangement.spacedBy(Spacing.xl),
    ) {
        Card {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.m), verticalAlignment = Alignment.Top) {
                Icon(Icons.Outlined.NotificationsActive, contentDescription = null, tint = Color.yard.violet, modifier = Modifier.size(20.dp))
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    Text(
                        "Brands you follow and the drop reminders you set only reach you for the topics, and through the channels, switched on below.",
                        style = YardFonts.callout,
                        color = Color.yard.ink,
                    )
                    val n = follows.items.size
                    if (n > 0) {
                        Text(youFollowingNote(n), style = YardFonts.caption, color = Color.yard.ink2)
                    }
                }
            }
        }

        YouSettingsGroup("Tell me about") {
            YouNotifyTopic.entries.forEach { topic ->
                YouToggleRow(
                    title = topic.title,
                    detail = topic.detail,
                    icon = topic.icon,
                    isOn = topic.value(model.prefs.inApp),
                    onChange = { model.setTopic(topic, it, toast) },
                )
            }
        }

        YouSettingsGroup(
            "Send them by",
            footer = if (model.emailOn) "Account, order and payout emails are always sent."
            else "Email is off. Updates still appear in Notifications and your Following feed, but nothing will be emailed to you.",
        ) {
            YouToggleRow(
                title = "Email",
                detail = "Sent to ${session.shopper?.email?.ifEmpty { null } ?: "the address on your account"}.",
                icon = Icons.Outlined.Email,
                isOn = model.emailOn,
                onChange = { model.setEmail(it, toast) },
            )
            SettingsRow(
                "Push on this phone",
                Icons.Outlined.PhoneAndroid,
                Modifier.youRowClick {
                    val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    runCatching { context.startActivity(intent) }
                },
                value = "System settings",
            )
        }

        model.readReceipts?.let { receipts ->
            YouSettingsGroup("Messages", footer = "Refunds, returns and delivery problems stay on each order page.") {
                YouToggleRow(
                    title = "Send read receipts",
                    detail = "Brands see “Seen” when you've read their reply. Turn it off and you won't see when they've read yours either.",
                    icon = Icons.Outlined.MarkChatRead,
                    isOn = receipts,
                    onChange = { model.setReadReceipts(it, toast) },
                )
            }
        }

        AnimatedContent(
            targetState = model.lastChange,
            transitionSpec = { fadeIn() togetherWith fadeOut() },
            label = "lastChange",
            modifier = Modifier.padding(horizontal = Spacing.xs),
        ) { note ->
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
                if (note != null) {
                    Icon(Icons.Filled.Check, contentDescription = null, tint = Color.yard.violet, modifier = Modifier.size(12.dp))
                    Text(note, style = YardFonts.caption, color = Color.yard.ink2)
                } else {
                    Text("Changes save as you switch.", style = YardFonts.caption, color = Color.yard.ink3)
                }
            }
        }
    }
}

internal fun youFollowingNote(count: Int): String =
    if (count == 1) "Right now that covers 1 brand." else "Right now that covers $count brands."

@Preview(name = "NotificationSettingsView — dark")
@Composable
private fun NotificationSettingsDark() = YardPreview(darkTheme = true) { NotificationSettingsView() }

@Preview(name = "NotificationSettingsView — light")
@Composable
private fun NotificationSettingsLight() = YardPreview(darkTheme = false, signedIn = false) { NotificationSettingsView() }
