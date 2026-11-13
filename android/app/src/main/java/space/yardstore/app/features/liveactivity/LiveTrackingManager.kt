package space.yardstore.app.features.liveactivity

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import space.yardstore.app.app.YardApp
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.features.liveactivity.YardOrderActivityAttributes.ContentState
import space.yardstore.app.features.liveactivity.YardOrderActivityAttributes.Step
import java.util.concurrent.ConcurrentHashMap
import kotlin.coroutines.cancellation.CancellationException

/**
 * Order tracking: start / update / end the ongoing notification for one brand's part of an order.
 * The Android stand-in for iOS `LiveActivityManager` (Lock Screen + Dynamic Island Live Activity).
 *
 *   // Once, with any Context (YardApp.onCreate ideally; LiveTrackingButton also does it):
 *   LiveTrackingManager.install(context)
 *
 *   // Orders screen, after loading an order (starts once shipped, updates it, ends it on delivery):
 *   scope.launch { LiveTrackingManager.sync(order.id) }
 *
 *   // App foreground (refresh what's running):
 *   scope.launch { LiveTrackingManager.resume() }
 *
 *   // Sign out: install() registers `endAll()` as a SessionStore sign-out listener.
 *
 * The posted notifications are the source of truth for what is running (like
 * `Activity.activities`): each carries its attributes in extras, so updates survive process death.
 * There is no push channel (iOS keeps APNs tokens for a future server push); the app refreshes the
 * notification whenever it syncs the order.
 */
object LiveTrackingManager {
    private const val LOG_TAG = "LiveTracking"

    @Volatile private var appContext: Context? = null

    /** Order ids with a running (ongoing) tracking notification. Compose state: observable. */
    var trackedOrderIds by mutableStateOf<Set<String>>(emptySet())
        private set

    /** The last error from the notification system or the API, for diagnostics. */
    var lastError by mutableStateOf<String?>(null)
        private set

    /** Brand cities already resolved, so a refresh doesn't re-read the storefront. */
    private val brandCities = ConcurrentHashMap<String, String>()
    private val mutex = Mutex()

    /** Idempotent: keeps the application context, creates the channel, hooks sign-out. */
    fun install(context: Context) {
        if (appContext != null) return
        synchronized(this) {
            if (appContext != null) return
            val app = context.applicationContext
            appContext = app
            runCatching { LiveTrackingNotification.ensureChannel(app) }
                .onFailure { Log.w(LOG_TAG, "could not create channel: $it") }
            runCatching { (app as? YardApp)?.container?.session?.addSignOutListener { endAll() } }
                .onFailure { Log.w(LOG_TAG, "could not register sign-out listener: $it") }
        }
        refreshTracked()
    }

    /**
     * Whether Yard may show order tracking: notifications allowed (POST_NOTIFICATIONS on Android 13+)
     * and the "Order tracking" channel not turned off. iOS: `areActivitiesEnabled`.
     */
    fun areNotificationsEnabled(context: Context? = appContext): Boolean {
        val ctx = context ?: return false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return false
        if (!NotificationManagerCompat.from(ctx).areNotificationsEnabled()) return false
        val channel = ctx.getSystemService(NotificationManager::class.java)?.getNotificationChannel(LiveTrackingNotification.CHANNEL_ID)
        return channel == null || channel.importance != NotificationManager.IMPORTANCE_NONE
    }

    fun isTracking(orderId: String): Boolean = runningAttributes(orderId) != null

    // MARK: Start / update / end

    /**
     * Starts (or, if one is running, updates) tracking for [order]. Returns false when it couldn't
     * start (notifications off, nothing to show, or not installed).
     */
    fun start(order: LiveActivityOrder): Boolean {
        val ctx = appContext ?: return false
        val state = order.state ?: return false
        if (order.brandCity.isNotEmpty()) brandCities[order.orderId] = order.brandCity
        if (runningAttributes(order.orderId) != null) {
            return post(ctx, order.attributes, state, live = true)
        }
        if (!areNotificationsEnabled(ctx)) return false
        val ok = post(ctx, order.attributes, state, live = true)
        refreshTracked()
        return ok
    }

    /** Loads [orderId] and starts tracking it (the button's path). Throws [APIError] on load failure. */
    suspend fun start(orderId: String): Boolean {
        val order = LiveActivityOrder.load(orderId, brandCities[orderId])
        return start(order)
    }

    /** Updates the running notification of [orderId] with [state] (no-op when none is running). */
    fun update(orderId: String, state: ContentState) {
        val ctx = appContext ?: return
        val attributes = runningAttributes(orderId) ?: return
        post(ctx, attributes, state, live = true)
    }

    /**
     * Ends tracking of [orderId]. With a final state it stays in the shade a while (delivered:
     * 2 hours, no longer ongoing) unless [immediately].
     */
    fun end(orderId: String, finalState: ContentState? = null, immediately: Boolean = false) {
        val ctx = appContext ?: return
        val attributes = runningAttributes(orderId) ?: return
        if (finalState != null && !immediately) {
            post(ctx, attributes, finalState, live = false)
        } else {
            NotificationManagerCompat.from(ctx).cancel(LiveTrackingNotification.tag(orderId), LiveTrackingNotification.NOTIFICATION_ID)
        }
        brandCities.remove(orderId)
        refreshTracked()
    }

    /** Ends every tracking notification, including delivered ones still showing (sign out). */
    fun endAll() {
        val ctx = appContext ?: return
        val manager = NotificationManagerCompat.from(ctx)
        for (sbn in activeTrackingNotifications(ctx)) manager.cancel(sbn.tag, sbn.id)
        brandCities.clear()
        refreshTracked()
    }

    // MARK: Sync with the API

    /**
     * Reads the order and does the right thing: starts tracking once it has shipped, updates a
     * running notification, ends it when delivered (kept 2 h) or cancelled/returned (removed).
     */
    suspend fun sync(orderId: String) {
        val order = try {
            LiveActivityOrder.load(orderId, brandCities[orderId])
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            val message = APIError.messageFor(e)
            if (message.isNotEmpty()) lastError = message
            if (e is APIError && (e.isNotFound || e.isUnauthorized)) end(orderId, immediately = true)
            return
        }
        apply(order)
    }

    /** Applies an already-loaded snapshot (e.g. from the Orders screen's own data). */
    suspend fun apply(order: LiveActivityOrder) = mutex.withLock {
        if (order.brandCity.isNotEmpty()) brandCities[order.orderId] = order.brandCity
        if (order.isClosed) {
            end(order.orderId, immediately = true)
            return@withLock
        }
        val state = order.state ?: return@withLock
        val running = runningAttributes(order.orderId) != null
        when (state.step) {
            Step.Delivered -> if (running) end(order.orderId, finalState = state)
            // Never auto-start before it ships; keep a running one current.
            Step.Packed -> if (running) update(order.orderId, state)
            Step.Shipped, Step.OutForDelivery, Step.ArrivingSoon ->
                if (running) update(order.orderId, state) else start(order)
        }
    }

    /** On launch / foreground: refresh every running tracking notification. */
    suspend fun resume() {
        val ctx = appContext ?: return
        for (sbn in activeTrackingNotifications(ctx)) {
            val attributes = LiveTrackingNotification.attributes(sbn.notification.extras) ?: continue
            if (attributes.brandCity.isNotEmpty()) brandCities[attributes.orderId] = attributes.brandCity
        }
        refreshTracked()
        for (orderId in trackedOrderIds) sync(orderId)
    }

    /** Re-reads what is showing (the person may have swiped a notification away). */
    fun refreshTracked() {
        val ctx = appContext ?: return
        trackedOrderIds = activeTrackingNotifications(ctx)
            .filter { it.notification.extras.getBoolean(LiveTrackingNotification.EXTRA_LIVE, false) }
            .mapNotNull { it.notification.extras.getString(LiveTrackingNotification.EXTRA_ORDER_ID) }
            .toSet()
    }

    // MARK: Private

    private fun activeTrackingNotifications(ctx: Context) =
        runCatching {
            ctx.getSystemService(NotificationManager::class.java)?.activeNotifications.orEmpty()
                .filter { it.tag?.startsWith(LiveTrackingNotification.TAG_PREFIX) == true }
        }.getOrDefault(emptyList())

    /** The attributes of the running (live) notification for [orderId], or null. */
    private fun runningAttributes(orderId: String): YardOrderActivityAttributes? {
        val ctx = appContext ?: return null
        val sbn = activeTrackingNotifications(ctx).firstOrNull { it.tag == LiveTrackingNotification.tag(orderId) } ?: return null
        val extras = sbn.notification.extras
        if (!extras.getBoolean(LiveTrackingNotification.EXTRA_LIVE, false)) return null
        return LiveTrackingNotification.attributes(extras)
    }

    private fun post(ctx: Context, attributes: YardOrderActivityAttributes, state: ContentState, live: Boolean): Boolean {
        if (!areNotificationsEnabled(ctx)) return false
        return try {
            val notification = LiveTrackingNotification.build(ctx, attributes, state, live)
            NotificationManagerCompat.from(ctx).notify(
                LiveTrackingNotification.tag(attributes.orderId),
                LiveTrackingNotification.NOTIFICATION_ID,
                notification,
            )
            true
        } catch (e: SecurityException) {
            lastError = e.message
            Log.w(LOG_TAG, "could not post tracking for order ${attributes.orderId}: $e")
            false
        }
    }
}
