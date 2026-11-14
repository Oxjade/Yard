package space.yardstore.app.features.drops

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CompletableDeferred
import space.yardstore.app.app.MainActivity
import space.yardstore.app.core.Config
import space.yardstore.app.core.models.Drop
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.HTTPMethod
import space.yardstore.app.designsystem.components.Toast
import java.time.Instant

// MARK: - Writes (DropActions in DropsSupport.swift)

object DropActions {
    private fun path(id: String, tail: String): String = "/api/drops/${Config.encodePath(id)}/$tail"

    /** POST/DELETE /api/drops/{id}/reminder, then the local alert on this phone. */
    suspend fun setReminder(
        on: Boolean,
        drop: Drop,
        /** Null only in unit tests (no local alert). */
        context: Context?,
        permission: DropNotificationPermission?,
    ): DropLocalReminder.Outcome {
        APIClient.shared.send(if (on) HTTPMethod.POST else HTTPMethod.DELETE, path(drop.id, "reminder"))
        if (context == null) return if (on) DropLocalReminder.Outcome.TooSoon else DropLocalReminder.Outcome.Removed
        if (on) return DropLocalReminder.schedule(context, drop, permission)
        DropLocalReminder.cancel(context, drop.id)
        return DropLocalReminder.Outcome.Removed
    }

    /** POST/DELETE /api/drops/{id}/entry (draws, while entries are open). */
    suspend fun setEntry(on: Boolean, dropId: String) {
        APIClient.shared.send(if (on) HTTPMethod.POST else HTTPMethod.DELETE, path(dropId, "entry"))
    }

    /** The toast after a reminder change. */
    fun reminderMessage(on: Boolean, outcome: DropLocalReminder.Outcome): DropToastMessage {
        if (!on) return DropToastMessage("Reminder removed", Toast.Style.Info)
        return when (outcome) {
            DropLocalReminder.Outcome.Scheduled -> DropToastMessage("Reminder set. We'll alert you 10 minutes before it opens.", Toast.Style.Success)
            DropLocalReminder.Outcome.Denied -> DropToastMessage("Reminder set. Turn on notifications for Yard in Settings to get an alert on this phone.", Toast.Style.Success)
            DropLocalReminder.Outcome.TooSoon, DropLocalReminder.Outcome.Removed -> DropToastMessage("Reminder set", Toast.Style.Success)
        }
    }
}

// MARK: - Notification permission (Android 13+)

/** Asks for POST_NOTIFICATIONS from a screen (iOS `requestAuthorization`). Null in previews. */
class DropNotificationPermission internal constructor(private val launch: (CompletableDeferred<Boolean>) -> Unit) {
    suspend fun request(): Boolean {
        val result = CompletableDeferred<Boolean>()
        launch(result)
        return result.await()
    }
}

@Composable
fun rememberDropNotificationPermission(): DropNotificationPermission? {
    if (LocalInspectionMode.current) return null
    val pending = remember { arrayOfNulls<CompletableDeferred<Boolean>>(1) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        pending[0]?.complete(granted)
        pending[0] = null
    }
    val latest = rememberUpdatedState(launcher)
    return remember {
        DropNotificationPermission { deferred ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                pending[0]?.complete(false)
                pending[0] = deferred
                try {
                    latest.value.launch(Manifest.permission.POST_NOTIFICATIONS)
                } catch (e: Exception) {
                    pending[0] = null
                    deferred.complete(false)
                }
            } else {
                deferred.complete(false)
            }
        }
    }
}

// MARK: - Local notification 10 minutes before opening

/**
 * The "10 minutes before" alert (iOS `UNCalendarNotificationTrigger`): an [AlarmManager] alarm
 * that fires [DropReminderReceiver], which posts the notification. Alarms are keyed by drop id
 * (the intent's data URI), so scheduling again replaces and cancelling removes.
 */
object DropLocalReminder {
    enum class Outcome { Scheduled, Denied, TooSoon, Removed }

    const val LEAD_TIME_SECONDS: Long = 10 * 60
    const val CHANNEL_ID = "yard.drop-reminders"

    internal const val EXTRA_TITLE = "yard.drop.title"
    internal const val EXTRA_BODY = "yard.drop.body"
    internal const val EXTRA_URL = "yard.drop.url"
    internal const val EXTRA_PATH = "yard.drop.path"
    internal const val EXTRA_DROP_ID = "yard.drop.id"

    fun identifier(dropId: String): String = "yard.drop-reminder.$dropId"

    private fun alarmIntent(context: Context, dropId: String): Intent =
        Intent(context, DropReminderReceiver::class.java)
            .setAction("space.yardstore.app.DROP_REMINDER")
            .setData(Uri.parse("yard-drop-reminder://drop/${Uri.encode(dropId)}"))

    private fun requestCode(dropId: String): Int = identifier(dropId).hashCode()

    private fun notificationsAllowed(context: Context): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return false
        return NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    /**
     * Schedules (or reschedules) the alert. [permission] asks for notification permission when it
     * isn't granted yet; syncing passes null (never prompts).
     */
    suspend fun schedule(context: Context, drop: Drop, permission: DropNotificationPermission?): Outcome {
        val app = context.applicationContext
        val now = Instant.now()
        val opens = drop.reminderOpenDate(now) ?: return Outcome.TooSoon
        val fireAt = opens.minusSeconds(LEAD_TIME_SECONDS)
        if (fireAt.toEpochMilli() - now.toEpochMilli() <= 5_000) return Outcome.TooSoon

        var allowed = notificationsAllowed(app)
        if (!allowed && permission != null) {
            allowed = permission.request() && notificationsAllowed(app)
        }
        if (!allowed) return Outcome.Denied

        val waiting = drop.isDrawWaiting(drop.livePhase(now), now)
        val title = if (waiting) "Entries open in 10 minutes" else "${drop.name} opens in 10 minutes"
        val body = if (waiting) {
            "${drop.name} by ${drop.brandName}. Open Yard to enter the draw."
        } else {
            "${drop.brandName} · ${drop.accessLabel}. Open Yard to be ready."
        }
        val intent = alarmIntent(app, drop.id)
            .putExtra(EXTRA_TITLE, title)
            .putExtra(EXTRA_BODY, body)
            .putExtra(EXTRA_PATH, drop.webPath)
            .putExtra(EXTRA_URL, Config.webUrl(drop.webPath))
            .putExtra(EXTRA_DROP_ID, drop.id)
        val pending = PendingIntent.getBroadcast(
            app, requestCode(drop.id), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val alarms = app.getSystemService(AlarmManager::class.java) ?: return Outcome.Denied
        return try {
            val exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms.canScheduleExactAlarms()
            if (exact) {
                alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fireAt.toEpochMilli(), pending)
            } else {
                // No exact-alarm access (Android 12+ without SCHEDULE_EXACT_ALARM): the system may fire a little late.
                alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fireAt.toEpochMilli(), pending)
            }
            Outcome.Scheduled
        } catch (e: SecurityException) {
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fireAt.toEpochMilli(), pending)
            Outcome.Scheduled
        }
    }

    fun cancel(context: Context, dropId: String) {
        val app = context.applicationContext
        val pending = PendingIntent.getBroadcast(
            app, requestCode(dropId), alarmIntent(app, dropId),
            PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE,
        ) ?: return
        app.getSystemService(AlarmManager::class.java)?.cancel(pending)
        pending.cancel()
    }

    /** Keeps the local alert in line with the server's reminder (set on the web, or moved by the brand). */
    suspend fun sync(context: Context, drop: Drop, reminderOn: Boolean) {
        if (reminderOn && drop.livePhase(Instant.now()) == DropLivePhase.Upcoming) {
            schedule(context, drop, permission = null)
        } else if (!reminderOn) {
            cancel(context, drop.id)
        }
    }

    internal fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(CHANNEL_ID, "Drop reminders", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "An alert 10 minutes before a drop you asked to be reminded about opens."
        }
        manager.createNotificationChannel(channel)
    }
}

/**
 * Posts the drop reminder when its alarm fires. Tapping it opens the drop in the app
 * (MainActivity handles ACTION_VIEW links through `router.open`).
 *
 * Needs manifest registration (foundation file):
 *   <receiver android:name=".features.drops.DropReminderReceiver" android:exported="false" />
 */
class DropReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val title = intent.getStringExtra(DropLocalReminder.EXTRA_TITLE) ?: return
        val body = intent.getStringExtra(DropLocalReminder.EXTRA_BODY).orEmpty()
        val url = intent.getStringExtra(DropLocalReminder.EXTRA_URL)
        val dropId = intent.getStringExtra(DropLocalReminder.EXTRA_DROP_ID).orEmpty()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        DropLocalReminder.ensureChannel(context)

        val open = Intent(Intent.ACTION_VIEW, url?.let { Uri.parse(it) })
            .setClass(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val contentIntent = PendingIntent.getActivity(
            context, DropLocalReminder.identifier(dropId).hashCode(), open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(context, DropLocalReminder.CHANNEL_ID)
            .setSmallIcon(space.yardstore.app.R.drawable.ic_stat_yard)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setContentIntent(contentIntent)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(DropLocalReminder.identifier(dropId), 0, notification)
        } catch (e: SecurityException) {
            // Notifications were turned off between scheduling and firing.
        }
    }
}
