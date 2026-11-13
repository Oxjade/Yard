package space.yardstore.app.features.around

import space.yardstore.app.core.Formatters
import space.yardstore.app.core.models.YardDate
import java.time.DayOfWeek
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.roundToInt

// Opening hours and dates for places, computed in the PLACE's own time zone — a port of the
// website's src/lib/around/hours.ts and labels.ts (via ios/…/AroundTime.swift) so the app says
// the same sentences.

sealed interface AroundOpenState {
    data class Open(val closes: String) : AroundOpenState
    data class Closed(val opensDay: String?, val opensTime: String?, val today: Boolean, val tomorrow: Boolean) : AroundOpenState
}

/** One line of status for a card or the detail header, with a flag for the live / open dot. */
data class AroundStatusLine(val text: String, val tone: Tone) {
    enum class Tone { Live, Open, Neutral }
}

object AroundTime {
    // region Clock in a zone

    fun zone(identifier: String): ZoneId = runCatching { ZoneId.of(identifier) }.getOrDefault(ZoneOffset.UTC)

    /** The weekday key ("mon"…"sun") and minutes after midnight at [date] in [tz]. */
    fun localClock(date: Instant, tz: String): Pair<String, Int> {
        val t = date.atZone(zone(tz))
        val key = when (t.dayOfWeek) {
            DayOfWeek.MONDAY -> "mon"
            DayOfWeek.TUESDAY -> "tue"
            DayOfWeek.WEDNESDAY -> "wed"
            DayOfWeek.THURSDAY -> "thu"
            DayOfWeek.FRIDAY -> "fri"
            DayOfWeek.SATURDAY -> "sat"
            DayOfWeek.SUNDAY, null -> "sun"
        }
        return key to (t.hour * 60 + t.minute)
    }

    fun toMinutes(hhmm: String): Int {
        val parts = hhmm.split(":").mapNotNull { it.toIntOrNull() }
        if (parts.size != 2) return 0
        return parts[0] * 60 + parts[1]
    }

    private fun dayIndex(day: String): Int = AroundHours.dayKeys.indexOf(day).coerceAtLeast(0)
    private fun prevDay(day: String): String = AroundHours.dayKeys[(dayIndex(day) + 6) % 7]
    private fun nextDay(day: String): String = AroundHours.dayKeys[(dayIndex(day) + 1) % 7]

    // endregion

    // region Open now

    /** Open now? Ranges may end at 24:00 or after midnight ("22:00"–"02:00"). */
    fun openState(hours: AroundHours?, tz: String, at: Instant): AroundOpenState? {
        if (hours == null) return null
        val (day, minutes) = localClock(at, tz)
        for (r in hours.ranges(day)) {
            val from = toMinutes(r[0])
            var to = toMinutes(r[1])
            if (to <= from) to += 24 * 60
            if (minutes in from until to) {
                return AroundOpenState.Open(closes = if (r[1] == "24:00") "midnight" else r[1])
            }
        }
        for (r in hours.ranges(prevDay(day))) {
            val from = toMinutes(r[0])
            val to = toMinutes(r[1])
            if (to <= from && minutes < to) return AroundOpenState.Open(closes = r[1])
        }
        var d = day
        for (i in 0 until 8) {
            val sorted = hours.ranges(d).sortedBy { toMinutes(it[0]) }
            for (r in sorted) {
                if (i == 0 && toMinutes(r[0]) <= minutes) continue
                return AroundOpenState.Closed(opensDay = d, opensTime = r[0], today = i == 0, tomorrow = i == 1)
            }
            d = nextDay(d)
        }
        return AroundOpenState.Closed(opensDay = null, opensTime = null, today = false, tomorrow = false)
    }

    /** "Open, closes 19:00" / "Closed, opens 10:00" / "Closed, opens tomorrow 10:00" / "Closed, opens Tue 10:00". */
    fun openLine(state: AroundOpenState?): String? = when (state) {
        null -> null
        is AroundOpenState.Open -> "Open, closes ${state.closes}"
        is AroundOpenState.Closed -> {
            val day = state.opensDay
            val time = state.opensTime
            when {
                day == null || time == null -> "Closed"
                state.today -> "Closed, opens $time"
                state.tomorrow -> "Closed, opens tomorrow $time"
                else -> "Closed, opens ${AroundHours.dayShort[day] ?: day} $time"
            }
        }
    }

    /** The detail page's sentence: "Open now, closes 19:00" / "Closed now, opens Tuesday 10:00". */
    fun openNowLine(state: AroundOpenState): String = when (state) {
        is AroundOpenState.Open -> "Open now, closes ${state.closes}"
        is AroundOpenState.Closed -> {
            val day = state.opensDay
            val time = state.opensTime
            when {
                day == null || time == null -> "Closed now"
                state.today -> "Closed now, opens $time"
                state.tomorrow -> "Closed now, opens tomorrow $time"
                else -> "Closed now, opens ${AroundHours.dayLabels[day] ?: day} $time"
            }
        }
    }

    // endregion

    // region Dated places

    enum class Timed { Upcoming, Live, Ended }

    fun timedStatus(startsAt: String?, endsAt: String?, at: Instant): Timed? {
        val s = YardDate.parse(startsAt) ?: return null
        val e = YardDate.parse(endsAt) ?: return null
        if (at >= e) return Timed.Ended
        if (at >= s) return Timed.Live
        return Timed.Upcoming
    }

    /** The status line of a card: hours for stores and showrooms, dates for pop-ups and exhibitions. */
    fun statusLine(p: AroundPlace, at: Instant): AroundStatusLine? {
        if (p.kind.isDated) {
            val status = timedStatus(p.startsAt, p.endsAt, at) ?: return null
            val starts = YardDate.parse(p.startsAt) ?: return null
            val ends = YardDate.parse(p.endsAt) ?: return null
            return when (status) {
                Timed.Live -> {
                    val sameDay = dayIn(ends, p.timeZone) == dayIn(at, p.timeZone)
                    val until = if (sameDay) timeIn(ends, p.timeZone) else "${dayIn(ends, p.timeZone)}, ${timeIn(ends, p.timeZone)}"
                    AroundStatusLine("Live now, until $until", AroundStatusLine.Tone.Live)
                }
                Timed.Ended -> AroundStatusLine("Ended", AroundStatusLine.Tone.Neutral)
                Timed.Upcoming -> AroundStatusLine("Starts ${dayIn(starts, p.timeZone)}, ${timeIn(starts, p.timeZone)}", AroundStatusLine.Tone.Neutral)
            }
        }
        if (p.byAppointment && p.hours == null) return AroundStatusLine("By appointment", AroundStatusLine.Tone.Neutral)
        val state = openState(p.hours, p.timeZone, at)
        val line = openLine(state)
            ?: return if (p.byAppointment) AroundStatusLine("By appointment", AroundStatusLine.Tone.Neutral) else null
        val isOpen = state is AroundOpenState.Open
        return AroundStatusLine(
            if (p.byAppointment) "$line, by appointment" else line,
            if (isOpen) AroundStatusLine.Tone.Open else AroundStatusLine.Tone.Neutral,
        )
    }

    /** Whether a place is open (or a dated place live) right now. */
    fun isOpenNow(p: AroundPlace, at: Instant): Boolean {
        if (p.kind.isDated) return timedStatus(p.startsAt, p.endsAt, at) == Timed.Live
        return openState(p.hours, p.timeZone, at) is AroundOpenState.Open
    }

    /** "Drop 07: Third Mainland, on now" / "…, Sat 7 Nov 12:00". */
    fun nextEventLine(p: AroundPlace, at: Instant): String? {
        val e = p.nextEvent ?: return null
        if (e.title.isEmpty()) return null
        val starts = YardDate.parse(e.startsAt) ?: return null
        if (starts <= at) return "${e.title}, on now"
        return "${e.title}, ${dayIn(starts, p.timeZone)} ${timeIn(starts, p.timeZone)}"
    }

    // endregion

    // region Formatting in a zone

    private val enGB: Locale = Locale.forLanguageTag("en-GB")

    private fun format(pattern: String, date: Instant, tz: String): String =
        DateTimeFormatter.ofPattern(pattern, enGB).withZone(zone(tz)).format(date)

    /** "Sat 7 Nov". */
    fun dayIn(date: Instant, tz: String): String = format("EEE d MMM", date, tz)

    /** "12:00". */
    fun timeIn(date: Instant, tz: String): String = format("HH:mm", date, tz)

    /** "Sat 7 Nov, 12:00". */
    fun dayTimeIn(date: Instant, tz: String): String = "${dayIn(date, tz)}, ${timeIn(date, tz)}"

    /** "Sat 7 – Sun 8 Nov", "Sat 7 Nov", "Sat 31 Oct – Sun 1 Nov". An end at midnight belongs to the day before. */
    fun dateRange(starts: Instant, ends: Instant, tz: String): String {
        val endAt = ends.minusMillis(1)
        val z = zone(tz)
        val a = starts.atZone(z)
        val b = endAt.atZone(z)
        if (a.dayOfMonth == b.dayOfMonth && a.month == b.month) return dayIn(starts, tz)
        if (a.month == b.month) {
            return "${format("EEE", starts, tz)} ${format("d", starts, tz)} – ${format("EEE", endAt, tz)} ${format("d", endAt, tz)} ${format("MMM", endAt, tz)}"
        }
        return "${dayIn(starts, tz)} – ${dayIn(endAt, tz)}"
    }

    /** "WAT", "GMT+1". */
    fun zoneShort(tz: String, at: Instant): String {
        val known = mapOf("Africa/Lagos" to "WAT", "Africa/Accra" to "GMT", "Africa/Nairobi" to "EAT", "Africa/Johannesburg" to "SAST")
        known[tz]?.let { return it }
        return runCatching { DateTimeFormatter.ofPattern("zzz", Locale.ENGLISH).withZone(zone(tz)).format(at) }.getOrDefault(tz)
    }

    /** Whether the place's wall clock matches the phone's right now. */
    fun sameClock(tz: String, at: Instant): Boolean =
        zone(tz).rules.getOffset(at) == ZoneId.systemDefault().rules.getOffset(at)

    // endregion

    // region Distance

    /** "850 m", "1.2 km", "24 km" (website's formatDistance). */
    fun distance(meters: Double): String {
        val km = meters / 1000
        if (km < 1) {
            val m = maxOf(50, (km * 1000 / 50).roundToInt() * 50)
            return "$m m"
        }
        if (km < 10) return String.format(Locale.US, "%.1f km", km)
        return "${Formatters.grouped(km.roundToInt())} km"
    }

    // endregion
}
