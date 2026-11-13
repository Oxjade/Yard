package space.yardstore.app.core

import space.yardstore.app.core.models.MoneyFormatter
import space.yardstore.app.core.models.YardDate
import java.text.NumberFormat
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToLong

/** Shared formatting helpers (mirrors `Core/Formatters.swift`). Prices always go through here (or `PriceText` / `Money.formatted`). */
object Formatters {
    /** "$45" / "$45.50" from minor units + currency code. */
    fun price(minor: Int, currency: String, showCents: Boolean? = null): String =
        MoneyFormatter.format(minor, currency, showCents)

    /** "1.2K", "24K", "3.4M" (followers, counts). Under 1,000 → plain "252". */
    fun compactNumber(value: Double): String {
        val a = abs(value)
        val sign = if (value < 0) "-" else ""
        fun trim(v: Double, suffix: String): String {
            val rounded = Math.round(v * 10) / 10.0
            val text = if (rounded % 1.0 == 0.0) rounded.toLong().toString() else String.format(Locale.US, "%.1f", rounded)
            return sign + text + suffix
        }
        if (a >= 1_000_000_000) return trim(a / 1_000_000_000, "B")
        if (a >= 1_000_000) return trim(a / 1_000_000, "M")
        if (a >= 1_000) return trim(a / 1_000, "K")
        return sign + a.roundToLong().toString()
    }

    /** Integer convenience for [compactNumber]. */
    fun count(value: Int): String = compactNumber(value.toDouble())

    /** "1,234". */
    fun grouped(value: Int): String = NumberFormat.getIntegerInstance().format(value)

    /** "2m ago", "3h ago", "Yesterday", "4d ago", then "12 Nov" / "12 Nov 2025". */
    fun relative(date: Instant, now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): String {
        val seconds = Duration.between(date, now).seconds.toDouble()
        if (seconds < 0) return future(date, now, zone)
        if (seconds < 60) return "Just now"
        if (seconds < 3600) return "${(seconds / 60).toInt()}m ago"
        if (seconds < 86_400) return "${(seconds / 3600).toInt()}h ago"
        if (date.atZone(zone).toLocalDate() == now.atZone(zone).toLocalDate().minusDays(1)) return "Yesterday"
        if (seconds < 7 * 86_400) return "${(seconds / 86_400).toInt()}d ago"
        return shortDate(date, now, zone)
    }

    /** Relative from an API timestamp string; empty string when it can't be parsed. */
    fun relative(iso: String?): String {
        val d = YardDate.parse(iso) ?: return ""
        return relative(d)
    }

    /** "in 5m", "in 3h", "in 2d", "Tomorrow" for future dates (drops). */
    fun future(date: Instant, now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): String {
        val seconds = Duration.between(now, date).seconds.toDouble()
        if (seconds <= 0) return "Now"
        if (seconds < 3600) return "in ${max(1, (seconds / 60).toInt())}m"
        if (seconds < 86_400) return "in ${(seconds / 3600).toInt()}h"
        if (date.atZone(zone).toLocalDate() == now.atZone(zone).toLocalDate().plusDays(1)) return "Tomorrow"
        return "in ${(seconds / 86_400).toInt()}d"
    }

    /** "12 Nov" this year, "12 Nov 2025" otherwise. */
    fun shortDate(date: Instant, now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): String {
        val d: LocalDate = date.atZone(zone).toLocalDate()
        val sameYear = d.year == now.atZone(zone).year
        val pattern = if (sameYear) "d MMM" else "d MMM yyyy"
        return DateTimeFormatter.ofPattern(pattern, Locale.getDefault()).format(d)
    }

    /** "Thu 12 Nov, 18:00". */
    fun dateTime(date: Instant, zone: ZoneId = ZoneId.systemDefault()): String =
        DateTimeFormatter.ofPattern("EEE d MMM, HH:mm", Locale.getDefault()).format(date.atZone(zone))

    /** "18:00" (the locale's short time). */
    fun time(date: Instant, zone: ZoneId = ZoneId.systemDefault()): String =
        DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(Locale.getDefault()).format(date.atZone(zone))

    /** Countdown "2d 04:12:09" / "04:12:09" from an interval in seconds (clamped at 0). */
    fun countdown(seconds: Double): String {
        val total = max(0L, seconds.toLong())
        val d = total / 86_400
        val h = (total % 86_400) / 3600
        val m = (total % 3600) / 60
        val s = total % 60
        val clock = String.format(Locale.US, "%02d:%02d:%02d", h, m, s)
        return if (d > 0) "${d}d $clock" else clock
    }

    /** Countdown from a [Duration]. */
    fun countdown(duration: Duration): String = countdown(duration.seconds.toDouble())

    /** Countdown until [target] from [now]. */
    fun countdown(target: Instant, now: Instant = Instant.now()): String = countdown(Duration.between(now, target))
}
