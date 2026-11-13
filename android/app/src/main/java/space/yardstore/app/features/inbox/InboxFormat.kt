package space.yardstore.app.features.inbox

import android.text.format.DateFormat
import space.yardstore.app.core.Formatters
import space.yardstore.app.core.models.YardDate
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Inbox wording and dates, matching the website (src/components/inbox/format.ts). Mirrors `InboxFormat.swift`. */
object InboxFormat {
    /** iOS `setLocalizedDateFormatFromTemplate`; falls back to the en pattern off-device (unit tests). */
    private fun localized(skeleton: String): DateTimeFormatter {
        val locale = Locale.getDefault()
        val pattern = runCatching { DateFormat.getBestDateTimePattern(locale, skeleton) }.getOrNull()
            ?: when (skeleton) {
                "EEEdMMM" -> "EEE d MMM"
                "EEEdMMMyyyy" -> "EEE d MMM yyyy"
                "dMMMyyyy" -> "d MMM yyyy"
                else -> skeleton
            }
        return DateTimeFormatter.ofPattern(pattern, locale)
    }

    /** "Today", "Yesterday", "Wed 4 Nov" (with the year when it isn't this year). */
    fun dayLabel(date: Instant, now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): String {
        val d = date.atZone(zone).toLocalDate()
        val today = now.atZone(zone).toLocalDate()
        if (d == today) return "Today"
        if (d == today.minusDays(1)) return "Yesterday"
        val skeleton = if (d.year == today.year) "EEEdMMM" else "EEEdMMMyyyy"
        return localized(skeleton).format(d)
    }

    /** "14:05". */
    fun time(date: Instant): String = Formatters.time(date)

    /** List row time: "14:05" today, "Yesterday", "Wed" this week, else "4 Nov". */
    fun rowTime(iso: String, now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): String {
        val d = YardDate.parse(iso) ?: return ""
        val day = d.atZone(zone).toLocalDate()
        val today = now.atZone(zone).toLocalDate()
        if (day == today) return time(d)
        if (day == today.minusDays(1)) return "Yesterday"
        if (Duration.between(d, now).seconds < 6 * 86_400) return localized("EEE").format(d.atZone(zone))
        return Formatters.shortDate(d, now)
    }

    /** "4 Nov 2026". */
    fun shortDate(iso: String?): String {
        val d = YardDate.parse(iso) ?: return ""
        return localized("dMMMyyyy").format(d.atZone(ZoneId.systemDefault()))
    }

    /** A sentence that ends with a name: no second full stop ("Kumasi Thread Co."). */
    fun sentence(text: String): String {
        val t = text.trim()
        val last = t.lastOrNull()
        if (last != null && last in ".!?") return t
        return "$t."
    }

    /** The disabled-composer line for a shopper (shopperDisabledReason on the website). Null = can send. */
    fun disabledReason(i: InboxInteraction?, brand: String): String? {
        if (i == null || i.canSend) return null
        return when (i.reason ?: "") {
            "blocked_by_them" -> sentence("You can't message $brand")
            "blocked_by_me" -> "${sentence("You blocked $brand")} Unblock them from the menu to send a message."
            "restricted" -> {
                val until = shortDate(i.until)
                if (i.until != null && until.isNotEmpty()) "Messaging is paused on your account until $until."
                else "Messaging is paused on your account."
            }
            "locked" -> "This conversation was closed by Yard."
            "brand_unavailable" -> "$brand isn't taking messages right now."
            else -> "You can't send messages here right now."
        }
    }

    /** Shopper order status labels (customerOrderStatus on the website). */
    fun orderStatus(status: String): String = when (status) {
        "pending_payment" -> "Awaiting payment"
        "paid" -> "Confirmed"
        "processing" -> "Being prepared"
        "shipped" -> "On its way"
        "delivered" -> "Delivered"
        "cancelled" -> "Cancelled"
        "refund_requested" -> "Return requested"
        "refunded" -> "Refunded"
        else -> status.replace("_", " ").split(" ").joinToString(" ") { w ->
            w.lowercase().replaceFirstChar { it.titlecase(Locale.getDefault()) }
        }
    }

    /** Held message explanation (heldCopy.customer). */
    const val heldCopy = "Held for review. Messages with several links or payment requests outside Yard are checked first."
    /** Safety notice above a scored message (safetyCopy.customer). */
    const val safetyCopy = "Keep payments on Yard. Never pay a brand outside checkout."
}
