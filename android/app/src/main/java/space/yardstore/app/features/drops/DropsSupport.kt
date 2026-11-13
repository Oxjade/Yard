package space.yardstore.app.features.drops

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.constrainWidth
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.layout
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.serialization.Serializable
import space.yardstore.app.core.Formatters
import space.yardstore.app.core.models.Drop
import space.yardstore.app.core.models.YardDate
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.components.Tag
import space.yardstore.app.designsystem.components.TagStyle
import space.yardstore.app.designsystem.components.Toast
import space.yardstore.app.designsystem.yard
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

// Drops feature helpers: the shopper-clock phase (port of src/lib/api/drops.ts `dropPhaseAt`),
// the wording the website uses (live-drops-board.tsx, live-drop-detail.tsx), the shopper's own
// drops (GET /api/drops/me), and small shared composables. Mirrors DropsSupport.swift.
// The local "10 minutes before" alert lives in DropLocalReminder.kt; the writes in DropActions there.

// MARK: - Phase on the shopper's clock

/** The phase a drop is in at a given moment, recomputed on device. Mirrors `dropPhaseAt` on the website. */
enum class DropLivePhase { Upcoming, EntriesOpen, EarlyAccess, Live, Ended }

private val DistantFuture: Instant = Instant.MAX
private val DistantPast: Instant = Instant.MIN

fun Drop.livePhase(now: Instant): DropLivePhase {
    val end = endDate ?: DistantFuture
    if (status == "ended" || status == "cancelled" || now >= end) return DropLivePhase.Ended
    val start = startDate ?: DistantFuture
    val drawn = !drawnAt.isNullOrEmpty()
    if (access == "draw" && !drawn) {
        val opens = YardDate.parse(entryOpensAt) ?: DistantPast
        val closes = YardDate.parse(entryClosesAt) ?: start
        if (now >= opens && now < closes) return DropLivePhase.EntriesOpen
    }
    if (access == "early_access") {
        val early = YardDate.parse(earlyAccessAt)
        if (early != null && now >= early && now < start) return DropLivePhase.EarlyAccess
    }
    if (now >= start) return DropLivePhase.Live
    return DropLivePhase.Upcoming
}

/** When a draw's entries close (entryClosesAt, else the release). */
val Drop.entriesCloseDate: Instant? get() = YardDate.parse(entryClosesAt) ?: startDate

/** A released draw: its window belongs to the drawn winners ("Winners buying"). */
fun Drop.isWinnersWindow(phase: DropLivePhase): Boolean = phase == DropLivePhase.Live && isDraw

/** A draw whose entries haven't opened yet. */
fun Drop.isDrawWaiting(phase: DropLivePhase, now: Instant): Boolean {
    if (!isDraw || phase != DropLivePhase.Upcoming) return false
    val opens = YardDate.parse(entryOpensAt) ?: return false
    return opens > now
}

/** "Live now", "Entries open", "Winners buying", "Upcoming", "Ended"… (website badges). */
fun Drop.statusLabel(phase: DropLivePhase): String = when (phase) {
    DropLivePhase.EntriesOpen -> "Entries open"
    DropLivePhase.EarlyAccess -> "Early access"
    DropLivePhase.Live -> if (isDraw) "Winners buying" else "Live now"
    DropLivePhase.Ended -> if (isDraw) "Draw closed" else "Ended"
    DropLivePhase.Upcoming -> "Upcoming"
}

/** Acid badge (and the live pulse) for what a shopper can act on right now. */
fun Drop.isHot(phase: DropLivePhase): Boolean =
    (phase == DropLivePhase.Live && !isDraw) || phase == DropLivePhase.EntriesOpen

/** "Releases Thu 14 Nov, 18:00" etc., in the shopper's time zone. */
fun Drop.timingText(phase: DropLivePhase, now: Instant): String {
    fun at(date: Instant?): String = date?.let { Formatters.dateTime(it) } ?: ""
    return when (phase) {
        DropLivePhase.Live -> if (isDraw) "Winners and the waitlist can buy until ${at(endDate)}" else "Closes ${at(endDate)}"
        DropLivePhase.Ended -> "Closed ${at(endDate)}"
        DropLivePhase.EntriesOpen -> "Entries close ${at(entriesCloseDate)}"
        DropLivePhase.EarlyAccess -> "Early access · public release ${at(startDate)}"
        DropLivePhase.Upcoming ->
            if (isDrawWaiting(phase, now)) "Entries open ${at(YardDate.parse(entryOpensAt))}" else "Releases ${at(startDate)}"
    }
}

/** What the big countdown counts to. */
data class DropCountdownTarget(val label: String, val date: Instant)

/** The moment the big countdown counts to, with its label; null once ended. */
fun Drop.countdownTarget(phase: DropLivePhase, now: Instant): DropCountdownTarget? = when (phase) {
    DropLivePhase.Upcoming -> {
        val opens = YardDate.parse(entryOpensAt)
        val closes = entriesCloseDate
        val start = startDate
        when {
            isDrawWaiting(phase, now) && opens != null -> DropCountdownTarget("Entries open in", opens)
            isDraw && closes != null -> DropCountdownTarget("Entries close in", closes)
            start != null -> DropCountdownTarget("Opens in", start)
            else -> null
        }
    }
    DropLivePhase.EntriesOpen -> entriesCloseDate?.let { DropCountdownTarget("Entries close in", it) }
    DropLivePhase.EarlyAccess -> startDate?.let { DropCountdownTarget("Public release in", it) }
    DropLivePhase.Live -> endDate?.let { DropCountdownTarget(if (isDraw) "Window closes in" else "Closes in", it) }
    DropLivePhase.Ended -> null
}

/** The date a "10 minutes before" local alert is built from: entries opening for a waiting draw, otherwise the release. */
fun Drop.reminderOpenDate(now: Instant): Instant? {
    val phase = livePhase(now)
    if (isDrawWaiting(phase, now)) return YardDate.parse(entryOpensAt)
    return startDate
}

/** "Draw release" / "Early access release" / "Limited release". */
val Drop.releaseKindLabel: String
    get() = when (access) {
        "draw" -> "Draw release"
        "early_access" -> "Early access release"
        else -> "Limited release"
    }

/** "1 piece" / "40 pieces". */
val Drop.runText: String get() = DropText.pluralize(totalUnits, "piece")

val Drop.brandName: String get() = brand.name ?: "Independent brand"

/** What a drop offers before release: a reminder, or (only while entries are open) a draw entry. */
fun Drop.actionMode(phase: DropLivePhase): DropActionMode? = when {
    phase == DropLivePhase.EntriesOpen && isDraw -> DropActionMode.Entry
    phase == DropLivePhase.Upcoming -> DropActionMode.Reminder
    else -> null
}

/** Website path, for share links and notification deep links. */
val Drop.webPath: String get() = "/drops/$slug"

enum class DropActionMode { Reminder, Entry }

data class DropEntryStatusText(val label: String, val style: TagStyle)

object DropText {
    fun pluralize(n: Int, word: String): String = "${Formatters.grouped(n)} $word${if (n == 1) "" else "s"}"

    /** "1 day" / "2 hours" / "45 minutes" (a draw winner's purchase window). */
    fun windowLength(minutes: Int): String = when {
        minutes % 1440 == 0 -> pluralize(minutes / 1440, "day")
        minutes % 60 == 0 -> pluralize(minutes / 60, "hour")
        else -> pluralize(minutes, "minute")
    }

    /** A draw entry's status as shoppers read it (never the raw code). */
    fun entryStatus(status: String): DropEntryStatusText = when (status) {
        "won" -> DropEntryStatusText("Winner", TagStyle.Success)
        "purchased" -> DropEntryStatusText("Purchased", TagStyle.Violet)
        "waitlisted" -> DropEntryStatusText("Waitlisted", TagStyle.Acid)
        "expired" -> DropEntryStatusText("Window expired", TagStyle.Neutral)
        "lost" -> DropEntryStatusText("Not selected", TagStyle.Neutral)
        "withdrawn" -> DropEntryStatusText("Withdrawn", TagStyle.Neutral)
        else -> DropEntryStatusText("Entered", TagStyle.Violet)
    }

    /** "Today" / "Tomorrow" / "Thursday 14 Nov". */
    fun dayTitle(day: LocalDate, now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): String {
        val today = now.atZone(zone).toLocalDate()
        if (day == today) return "Today"
        if (day == today.plusDays(1)) return "Tomorrow"
        val pattern = if (day.year == today.year) "EEEE d MMM" else "EEEE d MMM yyyy"
        return DateTimeFormatter.ofPattern(pattern, Locale.getDefault()).format(day)
    }
}

// MARK: - The shopper's drops (GET /api/drops/me)

@Serializable
data class MyDropsResponse(
    val entries: List<Entry> = emptyList(),
    val reminders: List<Reminder> = emptyList(),
) {
    @Serializable
    data class Entry(
        val drop: Drop,
        val status: String = "",
        val rank: Int? = null,
        val windowOpensAt: String? = null,
        val windowEndsAt: String? = null,
        val enteredAt: String? = null,
    ) {
        val id: String get() = drop.id
    }

    @Serializable
    data class Reminder(
        val dropId: String,
        val setAt: String? = null,
        val drop: Drop? = null,
    ) {
        val id: String get() = dropId
    }
}

/** A toast to show after an action. */
data class DropToastMessage(val text: String, val style: Toast.Style)

// MARK: - Clock

/** The current time, re-read every [periodMillis] (SwiftUI `TimelineView(.periodic…)`). */
@Composable
fun rememberDropsNow(periodMillis: Long): State<Instant> = produceState(Instant.now(), periodMillis) {
    while (true) {
        delay(periodMillis - (System.currentTimeMillis() % periodMillis).coerceAtMost(periodMillis - 1))
        value = Instant.now()
    }
}

/** Widens a full-line item in a padded lazy grid back to the screen edges. */
internal fun Modifier.dropsBleed(horizontal: Dp): Modifier = layout { measurable, constraints ->
    val extra = horizontal.roundToPx() * 2
    val wide = if (constraints.hasBoundedWidth) {
        constraints.copy(minWidth = constraints.minWidth + extra, maxWidth = constraints.maxWidth + extra)
    } else {
        constraints
    }
    val placeable = measurable.measure(wide)
    layout(constraints.constrainWidth(placeable.width), placeable.height) {
        placeable.place(-horizontal.roundToPx(), 0)
    }
}

// MARK: - Live pulse

/** The pulsing "live" dot: a solid dot with a ring that grows and fades, on repeat. */
@Composable
fun DropLivePulse(color: Color = Color.yard.onAcid, size: Dp = 7.dp) {
    val transition = rememberInfiniteTransition(label = "drop-pulse")
    val progress by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(1100, easing = LinearEasing), RepeatMode.Restart),
        label = "drop-pulse-progress",
    )
    Box(Modifier.size(size * 2.6f).clearAndSetSemantics { }, contentAlignment = Alignment.Center) {
        Box(
            Modifier
                .size(size)
                .graphicsLayer {
                    val s = 1f + 1.6f * progress
                    scaleX = s
                    scaleY = s
                    alpha = 0.55f * (1f - progress)
                }
                .background(color, CircleShape),
        )
        Box(Modifier.size(size).background(color, CircleShape))
    }
}

/** Status badge: acid with the live pulse when the shopper can act now, neutral otherwise. */
@Composable
fun DropStatusBadge(drop: Drop, phase: DropLivePhase, onPhoto: Boolean = false) {
    if (drop.isHot(phase)) {
        Row(
            Modifier
                .background(Color.yard.acid, YardShapes.pill)
                .padding(start = 6.dp, end = 9.dp, top = 5.dp, bottom = 5.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Box(Modifier.size(12.dp), contentAlignment = Alignment.Center) { DropLivePulse(Color.yard.onAcid, 4.dp) }
            Text(
                drop.statusLabel(phase).uppercase(),
                style = YardFonts.micro,
                color = Color.yard.onAcid,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    } else {
        Tag(drop.statusLabel(phase), style = if (onPhoto) TagStyle.OnPhoto else TagStyle.Neutral)
    }
}

// MARK: - Preview fixtures (previews only, never shown in the app)

object DropsPreviewFixtures {
    private fun iso(offsetSeconds: Long): String = Instant.now().plusSeconds(offsetSeconds).toString()

    val brand = Drop.BrandRef(id = "brd_preview", handle = "acme", name = "Acme Studio")

    val live = Drop(id = "drp_live", slug = "night-shift", brand = brand, name = "Night Shift", description = "Heavyweight fleece in washed black, cut and sewn in Lagos.", status = "live", phase = "live", startsAt = iso(-3600), endsAt = iso(7200), totalUnits = 40, productIds = listOf("prd_0", "prd_1"))
    val draw = Drop(id = "drp_draw", slug = "the-draw", brand = brand, name = "Archive Draw", description = "Twelve archive jackets by draw.", access = "draw", phase = "entries_open", startsAt = iso(86_400), endsAt = iso(172_800), entryOpensAt = iso(-3600), entryClosesAt = iso(80_000), purchaseWindowMinutes = 1440, winners = 12, totalUnits = 12)
    val upcoming = Drop(id = "drp_up", slug = "spring-capsule", brand = brand, name = "Spring Capsule", description = "Six pieces for the new season.", startsAt = iso(5400), endsAt = iso(90_000), totalUnits = 60)
    val tomorrow = Drop(id = "drp_up2", slug = "denim-02", brand = Drop.BrandRef(id = "brd_2", handle = "blue", name = "Blue Hour"), name = "Denim 02", startsAt = iso(100_000), endsAt = iso(190_000), totalUnits = 25)
    val past = Drop(id = "drp_past", slug = "winter-run", brand = brand, name = "Winter Run", status = "ended", phase = "ended", startsAt = iso(-400_000), endsAt = iso(-300_000), totalUnits = 30)
}
