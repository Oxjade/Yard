package space.yardstore.app.features.notifications

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.net.toUri
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.Serializable
import space.yardstore.app.BuildConfig
import space.yardstore.app.R
import space.yardstore.app.app.MainActivity
import space.yardstore.app.core.Config
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.HTTPMethod
import kotlin.coroutines.cancellation.CancellationException
import kotlin.coroutines.resume

// Remote push (Firebase Cloud Messaging). The website sends through FCM HTTP v1 whenever it creates
// an in-app notification for the shopper; see android/Docs/connect.md for the payload and setup.
// Firebase only starts when android/app/google-services.json was present at build time: without it
// every call here is a quiet no-op (FirebaseApp.getApps(context).isEmpty()).

private const val PUSH_LOG_TAG = "YardPush"

// region Message → notification (pure)

/**
 * A push as Yard shows it. Server payload:
 * `notification: { title, body }`, `data: { url: "/you/orders/ord_1", kind, id }`.
 */
data class YardPushMessage(
    /** The in-app notification id (`data.id`): the system notification's tag, so a repeat replaces it. */
    val id: String?,
    val title: String,
    val body: String,
    /** Same-origin path to open on tap (`data.url`, checked); "/notifications" when missing or unsafe. */
    val href: String,
    /** The notification kind (`data.kind`), informational. */
    val kind: String?,
) {
    val channelId: String get() = YardNotificationChannels.UPDATES
    val tag: String? get() = id

    companion object {
        const val FALLBACK_HREF = "/notifications"

        /** Null when there is nothing to show (no title and no body). */
        fun from(title: String?, body: String?, data: Map<String, String>): YardPushMessage? {
            val t = title?.trim()?.takeIf { it.isNotEmpty() } ?: data["title"]?.trim().orEmpty()
            val b = body?.trim()?.takeIf { it.isNotEmpty() } ?: data["body"]?.trim().orEmpty()
            if (t.isEmpty() && b.isEmpty()) return null
            return YardPushMessage(
                id = data["id"]?.trim()?.takeIf { it.isNotEmpty() },
                title = t.ifEmpty { "Yard" },
                body = b,
                href = safeHref(data["url"]) ?: FALLBACK_HREF,
                kind = data["kind"]?.trim()?.takeIf { it.isNotEmpty() },
            )
        }

        /** Only same-origin relative paths ("/x", never "//host" or "https://…"). */
        fun safeHref(raw: String?): String? {
            val href = raw?.trim() ?: return null
            if (!href.startsWith("/") || href.startsWith("//") || href.contains('\\')) return null
            if (href.any { it.isWhitespace() || it.isISOControl() }) return null
            return href
        }

        /**
         * A push the system showed while Yard was in the background opens the launcher activity
         * with the FCM data keys as extras. Returns its href ("" → the notifications list), or null
         * when the intent is not a push tap.
         */
        fun hrefFromTapExtras(get: (String) -> String?): String? {
            if (get("google.message_id") == null) return null
            return safeHref(get("url")).orEmpty()
        }
    }
}

// endregion

// region Device registration (POST / DELETE /api/devices)

/** POST /api/devices body. */
@Serializable
data class PushDeviceBody(val platform: String, val token: String, val appVersion: String? = null)

/** DELETE /api/devices body. */
@Serializable
data class PushDeviceDeleteBody(val token: String)

/** The website's push-device endpoints (signed-in session; 204 or `{ ok: true }`). */
object PushDevicesAPI {
    /** Tests only: a client and an absolute base URL (MockWebServer). */
    internal var clientOverride: APIClient? = null
    internal var baseOverride: String? = null

    private val api: APIClient get() = clientOverride ?: APIClient.shared
    private fun p(path: String): String = baseOverride?.let { it.trimEnd('/') + path } ?: path

    /** POST /api/devices { platform: "android", token, appVersion } — upsert, re-pointed to the caller. */
    suspend fun register(token: String, appVersion: String = BuildConfig.VERSION_NAME) {
        api.send(HTTPMethod.POST, p("/api/devices"), body = PushDeviceBody(platform = "android", token = token, appVersion = appVersion))
    }

    /** DELETE /api/devices { token } — before signing out, while the session still works. */
    suspend fun unregister(token: String) {
        api.send(HTTPMethod.DELETE, p("/api/devices"), body = PushDeviceDeleteBody(token = token))
    }
}

// endregion

// region Firebase

/** Firebase calls that are safe when Firebase isn't configured (no google-services.json). */
object YardFirebase {
    @Volatile private var loggedMissing = false

    fun isAvailable(context: Context): Boolean {
        val available = runCatching { FirebaseApp.getApps(context.applicationContext).isNotEmpty() }.getOrDefault(false)
        if (!available && !loggedMissing) {
            loggedMissing = true
            Log.i(PUSH_LOG_TAG, "Firebase is not configured (no google-services.json at build time): push is off.")
        }
        return available
    }

    /** This install's FCM token, or null (no Firebase, offline, Play services missing). */
    suspend fun currentToken(context: Context): String? {
        if (!isAvailable(context)) return null
        return try {
            suspendCancellableCoroutine { cont ->
                FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                    cont.resume(if (task.isSuccessful) task.result?.takeIf { it.isNotEmpty() } else null)
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.i(PUSH_LOG_TAG, "no FCM token: $e")
            null
        }
    }
}

// endregion

// region Showing a push

object YardPushNotifier {
    /** Shows [message] on the "Updates" channel. Does nothing without notification permission. */
    fun show(context: Context, message: YardPushMessage) {
        val app = context.applicationContext
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(app, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        val manager = NotificationManagerCompat.from(app)
        if (!manager.areNotificationsEnabled()) return
        YardNotificationChannels.create(app)
        val notification = NotificationCompat.Builder(app, message.channelId)
            .setSmallIcon(R.drawable.ic_stat_yard)
            .setColor(ContextCompat.getColor(app, R.color.yard_acid))
            .setContentTitle(message.title)
            .setContentText(message.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message.body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(tapIntent(app, message))
            .build()
        try {
            manager.notify(message.tag, NOTIFICATION_ID, notification)
        } catch (e: SecurityException) {
            Log.i(PUSH_LOG_TAG, "notification not shown: $e")
        }
    }

    /**
     * Opens MainActivity with the page's https link and [YardPushCenter.EXTRA_HREF], so the
     * existing notification-tap routing (`AppLinkRouting` → `YardPushCenter.handleTap`) navigates.
     */
    private fun tapIntent(context: Context, message: YardPushMessage): PendingIntent {
        val intent = Intent(Intent.ACTION_VIEW, Config.webUrl(message.href).toUri())
            .setClass(context, MainActivity::class.java)
            .putExtra(YardPushCenter.EXTRA_HREF, message.href)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(
            context,
            (message.tag ?: message.href).hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    /** One id for every push; the tag (notification id) tells them apart. */
    private const val NOTIFICATION_ID = 7_401
}

/**
 * FCM entry point. `onNewToken` keeps the token and registers it (a 401 while signed out is
 * ignored; the app registers again after sign-in). `onMessageReceived` runs for pushes that arrive
 * while Yard is in the foreground (the system shows them itself in the background, using the
 * manifest's default channel, icon and colour).
 */
class YardMessagingService : FirebaseMessagingService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onNewToken(token: String) {
        YardPushCenter.didRegister(applicationContext, token)
        scope.launch { YardPushCenter.upload(token) }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val shown = YardPushMessage.from(
            title = message.notification?.title,
            body = message.notification?.body,
            data = message.data,
        ) ?: return
        YardPushNotifier.show(applicationContext, shown)
    }
}

// endregion
