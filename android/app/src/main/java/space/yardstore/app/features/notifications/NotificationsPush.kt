package space.yardstore.app.features.notifications

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import space.yardstore.app.core.stores.SessionStore
import kotlin.coroutines.cancellation.CancellationException
import space.yardstore.app.app.AppTab
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.app.Route
import space.yardstore.app.core.stores.LocalFollowStore
import space.yardstore.app.core.stores.LocalSessionStore
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardDisplayText
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.components.YardButton
import space.yardstore.app.designsystem.components.YardButtonStyle
import space.yardstore.app.designsystem.components.YardSheet
import space.yardstore.app.designsystem.yard

// Notifications on the device: permission (Android 13+ POST_NOTIFICATIONS), channels, the soft
// "Never miss a drop" prompt, tap routing. Mirrors `NotificationsPush.swift`.
//
// Wiring (foundation, read-only for this package — the orchestrator adds these):
//
//   YardNotificationChannels.create(this)        // YardApp.onCreate (idempotent; also done by the host below)
//   YardPushNotifications()                      // inside RootView, below the store/router providers
//   YardPushCenter.handleTap(intent.getStringExtra(YardPushCenter.EXTRA_HREF))   // MainActivity, for notification taps
//
// Remote push: FCM (NotificationsRemotePush.kt). `YardPushCenter.install` (YardApp) unregisters the
// token before sign-out; `uploadTokenIfPossible` registers it on every sign-in and app start
// (POST /api/devices). See android/Docs/connect.md.

// region Permission

/** The notification permission, in iOS `UNAuthorizationStatus` terms. */
enum class NotificationsAuthorization { NotDetermined, Denied, Authorized }

/**
 * Asks for notification permission at good moments (never on launch): after the shopper's first
 * follow (automatic, via [YardPushNotifications]) and after they set a drop reminder
 * ([didSetDropReminder], for the Drops screen). For the You › Notifications screen: [status],
 * [rememberNotificationsPermissionRequest] and [openSystemSettings].
 */
object NotificationsPermission {
    /**
     * The current status. Android 12 and lower have no runtime permission: notifications are on
     * unless the shopper turned them off in Settings, so it is never [NotificationsAuthorization.NotDetermined] there.
     * Android 13+: [NotificationsAuthorization.NotDetermined] until the system prompt has been shown once by Yard.
     */
    fun status(context: Context): NotificationsAuthorization {
        if (NotificationManagerCompat.from(context).areNotificationsEnabled()) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
            ) {
                return NotificationsAuthorization.Authorized
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED &&
            !YardPushCenter.prefs(context).getBoolean(YardPushCenter.REQUESTED_KEY, false)
        ) {
            return NotificationsAuthorization.NotDetermined
        }
        return NotificationsAuthorization.Denied
    }

    /** True while the system prompt has never been shown. */
    fun canAsk(context: Context): Boolean = status(context) == NotificationsAuthorization.NotDetermined

    /** Call after the shopper turns on a drop reminder: offers notifications if never asked. */
    fun didSetDropReminder(context: Context, dropName: String? = null) {
        YardPushCenter.offerPermission(context, YardPushCenter.PrimingReason.DropReminder(dropName))
    }

    /** Opens Yard's notification settings in the system Settings app (for "Turn on in Settings" when denied). */
    fun openSystemSettings(context: Context) {
        val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { context.startActivity(intent) }.onFailure {
            val fallback = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.fromParts("package", context.packageName, null))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            runCatching { context.startActivity(fallback) }
        }
    }
}

/**
 * iOS `NotificationsPermission.request()`: returns a function that shows the system prompt
 * (Android 13+, only while never asked) and reports whether notifications are allowed. On older
 * Android, or once already decided, it reports the current status without a prompt.
 *
 *   val requestNotifications = rememberNotificationsPermissionRequest { allowed -> … }
 *   YardButton("Turn on notifications") { requestNotifications() }
 */
@Composable
fun rememberNotificationsPermissionRequest(onResult: (Boolean) -> Unit = {}): () -> Unit {
    val context = LocalContext.current
    val currentOnResult by rememberUpdatedState(onResult)
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) YardNotificationChannels.create(context)
        currentOnResult(granted)
    }
    return remember(launcher) {
        {
            when (NotificationsPermission.status(context)) {
                NotificationsAuthorization.Authorized -> {
                    YardNotificationChannels.create(context)
                    currentOnResult(true)
                }
                NotificationsAuthorization.Denied -> currentOnResult(false)
                NotificationsAuthorization.NotDetermined -> {
                    YardPushCenter.prefs(context).edit { putBoolean(YardPushCenter.REQUESTED_KEY, true) }
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
                    } else {
                        currentOnResult(true)
                    }
                }
            }
        }
    }
}

// endregion

// region Channels

/**
 * Yard's notification channels (Android 8+). Create once at launch with [create] (idempotent; cheap).
 * Other features post to these ids, e.g. the live-activity agent's ongoing order notification uses [ORDERS]:
 *
 *   NotificationCompat.Builder(context, YardNotificationChannels.ORDERS)
 *   NotificationCompat.Builder(context, YardNotificationChannels.idFor(category))   // server category
 */
object YardNotificationChannels {
    const val DROPS = "drops"
    const val ORDERS = "orders"
    const val MESSAGES = "messages"
    const val FOLLOWING = "following"
    const val WISHLIST = "wishlist"
    const val ACCOUNT = "account"
    const val GENERAL = "general"
    /** Remote pushes from the website (FCM `android.notification.channel_id`). */
    const val UPDATES = "yard_updates"

    private data class Spec(val id: String, val name: String, val description: String, val importance: Int)

    private val specs = listOf(
        Spec(DROPS, "Drops", "When a drop from a brand you follow goes live, and your drop reminders.", NotificationManagerCompat.IMPORTANCE_HIGH),
        Spec(ORDERS, "Orders and delivery", "Order confirmations, shipping and delivery updates.", NotificationManagerCompat.IMPORTANCE_DEFAULT),
        Spec(MESSAGES, "Messages", "Replies from brands in your inbox.", NotificationManagerCompat.IMPORTANCE_HIGH),
        Spec(FOLLOWING, "Brands you follow", "News and chart moves from the brands you follow.", NotificationManagerCompat.IMPORTANCE_DEFAULT),
        Spec(WISHLIST, "Wishlist", "Price drops and restocks on pieces you saved.", NotificationManagerCompat.IMPORTANCE_DEFAULT),
        Spec(ACCOUNT, "Account", "Updates about your Yard account.", NotificationManagerCompat.IMPORTANCE_DEFAULT),
        Spec(GENERAL, "Yard", "Everything else from Yard.", NotificationManagerCompat.IMPORTANCE_LOW),
        Spec(UPDATES, "Updates", "Order updates, replies from brands and drops, sent by Yard.", NotificationManagerCompat.IMPORTANCE_HIGH),
    )

    /** Creates (or updates the names of) every channel. Safe to call any number of times. */
    fun create(context: Context) {
        val channels = specs.map { spec ->
            NotificationChannelCompat.Builder(spec.id, spec.importance)
                .setName(spec.name)
                .setDescription(spec.description)
                .build()
        }
        NotificationManagerCompat.from(context).createNotificationChannelsCompat(channels)
    }

    /** The channel for a notification kind. */
    fun idFor(kind: ShopperNotificationKind): String = when (kind) {
        ShopperNotificationKind.Drop -> DROPS
        ShopperNotificationKind.Order -> ORDERS
        ShopperNotificationKind.Message -> MESSAGES
        ShopperNotificationKind.Follow -> FOLLOWING
        ShopperNotificationKind.Wishlist -> WISHLIST
        ShopperNotificationKind.Account -> ACCOUNT
        ShopperNotificationKind.Other -> GENERAL
    }

    /** The channel for a server notification `category` ("drop_update", "new_message", …). */
    fun idFor(category: String): String = idFor(ShopperNotificationKind.from(category))
}

// endregion

// region Push center

/** Shared state between the system (taps, tokens) and Compose. Mirrors `YardPushCenter`. */
object YardPushCenter {
    /** Intent extra a notification's tap intent carries: the same-origin `href` to open. */
    const val EXTRA_HREF = "space.yardstore.app.push.href"

    internal const val PREFS = "yard.push"
    /** The FCM token. */
    internal const val TOKEN_KEY = "yard.push.token"
    /** When the soft prompt was last dismissed with "Not now" (epoch seconds). */
    internal const val DECLINED_AT_KEY = "yard.push.softPromptDeclinedAt"
    /** Whether Yard has shown the Android 13+ system prompt (Android can't tell "never asked" from "denied"). */
    internal const val REQUESTED_KEY = "yard.push.permissionRequested"

    sealed interface PrimingReason {
        data object Follow : PrimingReason
        data class DropReminder(val dropName: String?) : PrimingReason
    }

    /** This install's FCM token (null until Firebase gives one, or without Firebase). */
    var deviceToken: String? by mutableStateOf(null)
        internal set
    /** A notification href the user tapped, waiting for the UI to route it. */
    var pendingHref: String? by mutableStateOf(null)
    /** The soft prompt shown before the system one. */
    var primingReason: PrimingReason? by mutableStateOf(null)
        private set

    internal fun prefs(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    // Tokens

    /** Keeps a new FCM token (`YardMessagingService.onNewToken`). */
    fun didRegister(context: Context, token: String) {
        if (token != deviceToken) {
            deviceToken = token
            prefs(context).edit { putString(TOKEN_KEY, token) }
        }
    }

    internal fun restoreToken(context: Context) {
        deviceToken = prefs(context).getString(TOKEN_KEY, null)
    }

    /**
     * Registers this device for push with the signed-in account (POST /api/devices). Runs on every
     * sign-in and on app start while signed in. Asks Firebase for the token when none is stored;
     * no Firebase → nothing to do. Never throws.
     */
    suspend fun uploadTokenIfPossible(context: Context) {
        val token = deviceToken
            ?: YardFirebase.currentToken(context)?.also { didRegister(context, it) }
            ?: return
        upload(token)
    }

    /** POST /api/devices; failures (signed out → 401, offline) are ignored and retried next time. */
    internal suspend fun upload(token: String) {
        try {
            PushDevicesAPI.register(token)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
        }
    }

    /** DELETE /api/devices { token } — called before sign-out (best effort, never throws). */
    suspend fun unregisterBeforeSignOut() {
        val token = deviceToken ?: return
        try {
            PushDevicesAPI.unregister(token)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
        }
    }

    /** App start (YardApp): restores the token and unregisters it before every sign-out. */
    fun install(context: Context, session: SessionStore) {
        restoreToken(context)
        hookSignOut(session)
    }

    internal fun hookSignOut(session: SessionStore) {
        session.addBeforeSignOutListener { unregisterBeforeSignOut() }
    }

    // Soft prompt

    /**
     * Offers notifications (soft prompt, then the system one) if the system has never asked and the
     * shopper didn't say "Not now" in the last 7 days.
     */
    fun offerPermission(context: Context, reason: PrimingReason) {
        if (!NotificationsPermission.canAsk(context)) return
        val declinedAt = prefs(context).getLong(DECLINED_AT_KEY, 0L)
        val now = System.currentTimeMillis() / 1000
        if (declinedAt > 0 && now - declinedAt < 7 * 86_400) return
        primingReason = reason
    }

    /** "Turn on": closes the soft prompt; the caller shows the system prompt. */
    fun acceptPriming() {
        primingReason = null
    }

    fun declinePriming(context: Context) {
        primingReason = null
        prefs(context).edit { putLong(DECLINED_AT_KEY, System.currentTimeMillis() / 1000) }
    }

    // Taps

    /**
     * Records a tapped notification's destination (from its tap intent's [EXTRA_HREF]). No href →
     * the notifications list. Pushes carry it as FCM `data.url` (see [YardPushMessage]).
     */
    fun handleTap(href: String?) {
        pendingHref = if (!href.isNullOrEmpty()) href else "/notifications"
    }
}

// endregion

// region Root host

/**
 * Notification wiring for the root (iOS `.yardPushNotifications()`): creates the channels, uploads
 * the token on sign-in, offers notifications after the first follow, routes tapped notifications,
 * and hosts the soft prompt. Compose it once, inside `RootView` below the store/router providers.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun YardPushNotifications() {
    val context = LocalContext.current
    val router = LocalRouter.current
    val follows = LocalFollowStore.current
    val session = LocalSessionStore.current
    val center = YardPushCenter

    LaunchedEffect(Unit) {
        withContext(Dispatchers.IO) {
            YardNotificationChannels.create(context)
            center.restoreToken(context)
        }
    }

    LaunchedEffect(session.shopper?.id ?: "signed-out") {
        if (session.isSignedIn) center.uploadTokenIfPossible(context)
    }

    // A tap on Follow inserts exactly one id after the list has loaded; a load happens while
    // `isLoading` is true (the previous emission), so it never counts as a follow.
    LaunchedEffect(follows) {
        data class FollowSnapshot(val ids: Set<String>, val isLoading: Boolean, val hasLoaded: Boolean)
        var previous: FollowSnapshot? = null
        snapshotFlow { FollowSnapshot(follows.followedIds, follows.isLoading, follows.hasLoaded) }.collect { current ->
            val old = previous
            previous = current
            if (old == null || !old.hasLoaded || old.isLoading || current.isLoading) return@collect
            if (current.ids.size == old.ids.size + 1 && current.ids.containsAll(old.ids)) {
                center.offerPermission(context, YardPushCenter.PrimingReason.Follow)
            }
        }
    }

    val pendingHref = center.pendingHref
    LaunchedEffect(pendingHref) {
        val href = pendingHref ?: return@LaunchedEffect
        center.pendingHref = null
        if (href == "/notifications") {
            router.show(Route.Notifications, AppTab.You)
            return@LaunchedEffect
        }
        when (val route = NotificationsRouting.route(href)) {
            null -> router.show(Route.Notifications, AppTab.You)
            is Route.Order, Route.Orders, is Route.Conversation, is Route.YardSupport, Route.Inbox, Route.MyDrops, Route.Notifications ->
                router.show(route, AppTab.You)
            else -> router.show(route, AppTab.Home)
        }
    }

    val requestPermission = rememberNotificationsPermissionRequest()
    val reason = center.primingReason
    if (reason != null && router.sheet == null) {
        val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        val scope = rememberCoroutineScope()
        fun close(then: () -> Unit) {
            scope.launch { sheetState.hide() }.invokeOnCompletion { then() }
        }
        YardSheet(
            onDismissRequest = { center.declinePriming(context) },
            sheetState = sheetState,
        ) {
            NotificationsPrimingSheet(
                reason = reason,
                onAccept = {
                    close {
                        center.acceptPriming()
                        requestPermission()
                    }
                },
                onDecline = { close { center.declinePriming(context) } },
            )
        }
    }
}

// endregion

// region Soft prompt

/**
 * "Never miss a drop" — shown right after the first follow or a drop reminder, before the system
 * prompt, so the one-time system dialog appears when it makes sense.
 */
@Composable
private fun NotificationsPrimingSheet(
    reason: YardPushCenter.PrimingReason,
    onAccept: () -> Unit,
    onDecline: () -> Unit,
) {
    val title = when (reason) {
        YardPushCenter.PrimingReason.Follow -> "Never miss a drop"
        is YardPushCenter.PrimingReason.DropReminder -> "Get your reminder"
    }
    val message = when (reason) {
        YardPushCenter.PrimingReason.Follow ->
            "Turn on notifications for drops from the brands you follow, order updates and replies from brands."
        is YardPushCenter.PrimingReason.DropReminder ->
            if (!reason.dropName.isNullOrEmpty()) {
                "Turn on notifications so we can tell you the moment ${reason.dropName} drops, plus order updates and replies from brands."
            } else {
                "Turn on notifications so we can tell you the moment it drops, plus order updates and replies from brands."
            }
    }

    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = Spacing.gutter)
            .padding(bottom = Spacing.l),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.l),
    ) {
        Box(
            Modifier
                .padding(top = Spacing.xl)
                .size(72.dp)
                .background(Color.yard.acid, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Outlined.NotificationsActive, contentDescription = null, tint = Color.yard.onAcid, modifier = Modifier.size(32.dp))
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
            YardDisplayText(title, size = 34.sp, color = Color.yard.ink, textAlign = TextAlign.Center)
            Text(message, style = YardFonts.body, color = Color.yard.ink2, textAlign = TextAlign.Center)
        }
        Spacer(Modifier.height(Spacing.s))
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
            YardButton("Turn on notifications", icon = Icons.Outlined.Notifications, style = YardButtonStyle.Primary, onClick = onAccept)
            YardButton("Not now", style = YardButtonStyle.Ghost, onClick = onDecline)
        }
    }
}

@Preview(name = "Push soft prompt — dark")
@Composable
private fun PrimingDarkPreview() = YardPreview(darkTheme = true) {
    NotificationsPrimingSheet(reason = YardPushCenter.PrimingReason.Follow, onAccept = {}, onDecline = {})
}

@Preview(name = "Push soft prompt — light")
@Composable
private fun PrimingLightPreview() = YardPreview(darkTheme = false) {
    NotificationsPrimingSheet(reason = YardPushCenter.PrimingReason.DropReminder("Night Shift"), onAccept = {}, onDecline = {})
}

// endregion
