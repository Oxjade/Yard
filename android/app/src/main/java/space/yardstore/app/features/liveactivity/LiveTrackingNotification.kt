package space.yardstore.app.features.liveactivity

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.text.format.DateFormat
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import space.yardstore.app.R
import space.yardstore.app.core.Formatters
import space.yardstore.app.features.liveactivity.YardOrderActivityAttributes.ContentState
import space.yardstore.app.features.liveactivity.YardOrderActivityAttributes.Step
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.ceil
import kotlin.math.roundToInt

// The Android stand-in for ios/YardLiveActivity (Lock Screen + Dynamic Island): one ongoing,
// silent notification per tracked order, on its own "order_tracking" channel.
//
//   title    = brand · step                    ("Ojuelegba Supply · Shipped")
//   text     = status line · ETA caption        ("On its way from Lagos · Arrives Thu 14 Nov")
//   subtext  = route                            ("Lagos → London")
//   progress = determinate bar from `progress`
//   when     = live countdown to the ETA within 24 h (iOS `Text(timerInterval:)`), else the update time
//   tap      = yard://you/orders/<id>; actions Details / Track (`?view=track`)

/** What the ETA slot shows, worked out once per render. Mirrors `OrderETA` in OrderActivityComponents.swift. */
sealed interface OrderETA {
    data object Delivered : OrderETA
    /** Within 24 hours: a live countdown. */
    data class Countdown(val eta: Instant) : OrderETA
    /** Further out: whole days plus the date. */
    data class Days(val days: Int, val eta: Instant) : OrderETA
    data object Unknown : OrderETA

    companion object {
        fun of(state: ContentState, now: Instant = Instant.now()): OrderETA {
            if (state.step == Step.Delivered) return Delivered
            val eta = state.etaDate ?: return Unknown
            if (!eta.isAfter(now)) return Unknown
            val remaining = Duration.between(now, eta).seconds.toDouble()
            if (remaining <= 24 * 3_600) return Countdown(eta)
            return Days(ceil(remaining / 86_400).toInt(), eta)
        }

        /** "Thu 14 Nov" in the person's locale (iOS template "EEE d MMM"). */
        fun formatDate(eta: Instant, zone: ZoneId = ZoneId.systemDefault()): String {
            val pattern = DateFormat.getBestDateTimePattern(Locale.getDefault(), "EEEdMMM")
            return DateTimeFormatter.ofPattern(pattern, Locale.getDefault()).withZone(zone).format(eta)
        }
    }
}

/** The big ETA figure as text: "3 days", "5h 11m", "—" (the island/Lock Screen figure). */
fun orderETAFigure(state: ContentState, now: Instant = Instant.now()): String = when (val eta = OrderETA.of(state, now)) {
    OrderETA.Delivered -> "Delivered"
    is OrderETA.Countdown -> {
        val minutes = Duration.between(now, eta.eta).toMinutes().coerceAtLeast(0)
        if (minutes >= 60) "${minutes / 60}h ${minutes % 60}m" else "${minutes}m"
    }
    is OrderETA.Days -> if (eta.days == 1) "1 day" else "${eta.days} days"
    OrderETA.Unknown -> "—"
}

/** The caption under the ETA figure. Mirrors `orderETACaption` (countdown says when, since the figure ticks). */
fun orderETACaption(state: ContentState, now: Instant = Instant.now()): String = when (val eta = OrderETA.of(state, now)) {
    OrderETA.Delivered -> "Delivered"
    is OrderETA.Countdown -> "Arrives by ${Formatters.time(eta.eta)}"
    is OrderETA.Days -> "Arrives " + OrderETA.formatDate(eta.eta)
    OrderETA.Unknown -> if (state.step == Step.Delivered) "Delivered" else "Estimate pending"
}

/** Builds the notification. Kept apart from [LiveTrackingManager] so the layout reads in one place. */
internal object LiveTrackingNotification {
    const val CHANNEL_ID = "order_tracking"
    /** Tag prefix: each order's notification is `order_tracking:<orderId>` with [NOTIFICATION_ID]. */
    const val TAG_PREFIX = "order_tracking:"
    const val NOTIFICATION_ID = 7_301

    // Extras so a running notification carries its attributes (like an Activity's attributes).
    const val EXTRA_ORDER_ID = "space.yardstore.app.tracking.orderId"
    const val EXTRA_BRAND_NAME = "space.yardstore.app.tracking.brandName"
    const val EXTRA_BRAND_CITY = "space.yardstore.app.tracking.brandCity"
    const val EXTRA_DELIVERY_CITY = "space.yardstore.app.tracking.deliveryCity"
    /** True while tracking runs (ongoing); false for the final "Delivered" notification kept 2 h. */
    const val EXTRA_LIVE = "space.yardstore.app.tracking.live"

    /** How long the final delivered notification stays (iOS dismissal policy: 2 hours). */
    const val FINAL_TIMEOUT_MS: Long = 2 * 3_600 * 1_000L

    fun tag(orderId: String): String = TAG_PREFIX + orderId

    fun ensureChannel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(CHANNEL_ID, "Order tracking", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Live progress of orders you track, from the brand to your door."
            setShowBadge(false)
            enableVibration(false)
            setSound(null, null)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }
        manager.createNotificationChannel(channel)
    }

    fun attributes(extras: Bundle): YardOrderActivityAttributes? {
        val orderId = extras.getString(EXTRA_ORDER_ID) ?: return null
        return YardOrderActivityAttributes(
            orderId = orderId,
            brandName = extras.getString(EXTRA_BRAND_NAME) ?: "The brand",
            brandCity = extras.getString(EXTRA_BRAND_CITY) ?: "",
            deliveryCity = extras.getString(EXTRA_DELIVERY_CITY) ?: "",
        )
    }

    fun build(
        context: Context,
        attributes: YardOrderActivityAttributes,
        state: ContentState,
        live: Boolean,
        now: Instant = Instant.now(),
    ): Notification {
        val eta = OrderETA.of(state, now)
        val origin = attributes.brandCity.ifEmpty { attributes.brandName }
        val destination = attributes.deliveryCity.ifEmpty { "Home" }
        val route = "$origin → $destination"
        val caption = orderETACaption(state, now)
        val title = "${attributes.brandName} · ${state.step.title}"
        val text = if (state.step == Step.Delivered) state.statusLine else "${state.statusLine} · $caption"

        val figure = orderETAFigure(state, now)
        val etaLine = when (eta) {
            is OrderETA.Days -> "$figure — $caption"
            is OrderETA.Countdown -> "Arrives in $figure — ${caption.replaceFirstChar { it.lowercase() }}"
            else -> caption
        }
        val bigText = buildString {
            append(state.statusLine)
            if (state.step != Step.Delivered) append('\n').append(etaLine)
            append('\n').append("From ").append(origin)
            if (attributes.brandCity.isNotEmpty()) append(" (").append(attributes.brandName).append(')')
            append(" to ").append(destination).append(" (You)")
        }

        val extras = Bundle().apply {
            putString(EXTRA_ORDER_ID, attributes.orderId)
            putString(EXTRA_BRAND_NAME, attributes.brandName)
            putString(EXTRA_BRAND_CITY, attributes.brandCity)
            putString(EXTRA_DELIVERY_CITY, attributes.deliveryCity)
            putBoolean(EXTRA_LIVE, live)
        }

        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setColor(ContextCompat.getColor(context, R.color.yard_acid))
            .setContentTitle(title)
            .setContentText(text)
            .setSubText(route)
            .setStyle(NotificationCompat.BigTextStyle().bigText(bigText).setBigContentTitle(title))
            .setCategory(if (live) NotificationCompat.CATEGORY_PROGRESS else NotificationCompat.CATEGORY_STATUS)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setOngoing(live)
            .setAutoCancel(!live)
            .setContentIntent(pendingLink(context, YardOrderActivityLink.details(attributes.orderId), attributes.orderId, 0))
            .addAction(0, "Details", pendingLink(context, YardOrderActivityLink.details(attributes.orderId), attributes.orderId, 1))
            .addAction(0, "Track", pendingLink(context, YardOrderActivityLink.track(attributes.orderId), attributes.orderId, 2))
            .addExtras(extras)

        if (live && state.step != Step.Delivered) {
            builder.setProgress(100, (state.clampedProgress * 100).roundToInt(), false)
        }
        if (eta is OrderETA.Countdown && live) {
            // A ticking countdown to the ETA in the header, like the island's timer.
            builder.setWhen(eta.eta.toEpochMilli())
                .setShowWhen(true)
                .setUsesChronometer(true)
                .setChronometerCountDown(true)
        } else {
            // Otherwise the header shows when this was last refreshed (honest staleness).
            builder.setWhen(now.toEpochMilli()).setShowWhen(true)
        }
        if (!live) builder.setTimeoutAfter(FINAL_TIMEOUT_MS)
        return builder.build()
    }

    private fun pendingLink(context: Context, uri: Uri, orderId: String, slot: Int): PendingIntent {
        val intent = Intent(Intent.ACTION_VIEW, uri)
            .setPackage(context.packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val requestCode = orderId.hashCode() * 3 + slot
        return PendingIntent.getActivity(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }
}
