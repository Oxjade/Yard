package space.yardstore.app.features.drops

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import space.yardstore.app.core.models.Drop
import space.yardstore.app.core.models.YardDate
import space.yardstore.app.designsystem.components.TagStyle
import space.yardstore.app.designsystem.components.Toast
import java.time.Instant
import java.time.ZoneId

class DropsSupportTest {
    private val now: Instant = Instant.parse("2026-11-13T12:00:00Z")
    private fun at(offset: Long) = now.plusSeconds(offset).toString()
    private val brand = Drop.BrandRef("brd_1", "acme", "Acme Studio")

    private fun firstCome(start: Long, end: Long, status: String = "scheduled") =
        Drop(id = "d1", slug = "d1-slug", brand = brand, name = "Night Shift", status = status, startsAt = at(start), endsAt = at(end), totalUnits = 40)

    private fun draw(start: Long, end: Long, opens: Long?, closes: Long?, drawnAt: String? = null) =
        Drop(id = "d2", slug = "the-draw", brand = brand, name = "Archive Draw", access = "draw", startsAt = at(start), endsAt = at(end),
            entryOpensAt = opens?.let { at(it) }, entryClosesAt = closes?.let { at(it) }, drawnAt = drawnAt)

    @Test fun firstComePhases() {
        assertEquals(DropLivePhase.Upcoming, firstCome(3600, 7200).livePhase(now))
        assertEquals(DropLivePhase.Live, firstCome(-60, 7200).livePhase(now))
        assertEquals(DropLivePhase.Ended, firstCome(-7200, -60).livePhase(now))
        assertEquals(DropLivePhase.Ended, firstCome(-60, 7200, status = "ended").livePhase(now))
        assertEquals(DropLivePhase.Ended, firstCome(3600, 7200, status = "cancelled").livePhase(now))
        // Missing dates never go live.
        assertEquals(DropLivePhase.Upcoming, firstCome(0, 0).copy(startsAt = "", endsAt = "").livePhase(now))
    }

    @Test fun drawPhases() {
        assertEquals(DropLivePhase.EntriesOpen, draw(86_400, 172_800, -3600, 80_000).livePhase(now))
        val waiting = draw(86_400, 172_800, 3600, 80_000)
        assertEquals(DropLivePhase.Upcoming, waiting.livePhase(now))
        assertTrue(waiting.isDrawWaiting(DropLivePhase.Upcoming, now))
        assertEquals(YardDate.parse(at(3600)), waiting.reminderOpenDate(now))
        // Entries closed, not released yet → upcoming (not waiting).
        val closed = draw(86_400, 172_800, -7200, -60)
        assertEquals(DropLivePhase.Upcoming, closed.livePhase(now))
        assertFalse(closed.isDrawWaiting(DropLivePhase.Upcoming, now))
        assertEquals(DropLivePhase.Live, draw(-60, 3600, -7200, -60, drawnAt = at(-60)).livePhase(now))
        // No entryClosesAt: entries close at the release.
        assertEquals(DropLivePhase.EntriesOpen, draw(3600, 7200, -60, null).livePhase(now))
    }

    @Test fun earlyAccessPhase() {
        val d = Drop(id = "d3", access = "early_access", earlyAccessAt = at(-60), startsAt = at(3600), endsAt = at(7200))
        assertEquals(DropLivePhase.EarlyAccess, d.livePhase(now))
        assertEquals("Public release in", d.countdownTarget(DropLivePhase.EarlyAccess, now)?.label)
        assertNull(d.actionMode(DropLivePhase.EarlyAccess))
        assertEquals("Early access release", d.releaseKindLabel)
    }

    @Test fun labelsAndCountdowns() {
        val live = firstCome(-60, 7200)
        assertEquals("Live now", live.statusLabel(DropLivePhase.Live))
        assertEquals("Closes in", live.countdownTarget(DropLivePhase.Live, now)?.label)
        assertTrue(live.isHot(DropLivePhase.Live))
        assertTrue(live.timingText(DropLivePhase.Live, now).startsWith("Closes "))
        assertNull(live.countdownTarget(DropLivePhase.Ended, now))
        assertEquals("Opens in", firstCome(3600, 7200).countdownTarget(DropLivePhase.Upcoming, now)?.label)

        val d = draw(-60, 3600, -7200, -60, drawnAt = at(-60))
        assertEquals("Winners buying", d.statusLabel(DropLivePhase.Live))
        assertEquals("Draw closed", d.statusLabel(DropLivePhase.Ended))
        assertEquals("Window closes in", d.countdownTarget(DropLivePhase.Live, now)?.label)
        assertFalse(d.isHot(DropLivePhase.Live))
        assertTrue(d.isWinnersWindow(DropLivePhase.Live))
        assertTrue(d.timingText(DropLivePhase.Live, now).startsWith("Winners and the waitlist can buy until "))

        val waiting = draw(86_400, 172_800, 3600, 80_000)
        assertEquals("Entries open in", waiting.countdownTarget(DropLivePhase.Upcoming, now)?.label)
        assertTrue(waiting.timingText(DropLivePhase.Upcoming, now).startsWith("Entries open "))
        val open = draw(86_400, 172_800, -3600, 80_000)
        assertEquals("Entries close in", open.countdownTarget(DropLivePhase.EntriesOpen, now)?.label)
        assertTrue(open.isHot(DropLivePhase.EntriesOpen))
        assertEquals("Draw release", open.releaseKindLabel)
        assertEquals("Limited release", live.releaseKindLabel)
    }

    @Test fun actionModes() {
        val open = draw(86_400, 172_800, -3600, 80_000)
        assertEquals(DropActionMode.Entry, open.actionMode(DropLivePhase.EntriesOpen))
        assertEquals(DropActionMode.Reminder, firstCome(3600, 7200).actionMode(DropLivePhase.Upcoming))
        assertNull(firstCome(-60, 7200).actionMode(DropLivePhase.Live))
    }

    @Test fun wordingHelpers() {
        assertEquals("/drops/d1-slug", firstCome(1, 2).webPath)
        assertEquals("Acme Studio", firstCome(1, 2).brandName)
        assertEquals("Independent brand", firstCome(1, 2).copy(brand = Drop.BrandRef("x")).brandName)
        assertEquals("1 piece", DropText.pluralize(1, "piece"))
        assertEquals("40 pieces", firstCome(1, 2).runText)
        assertEquals("1 day", DropText.windowLength(1440))
        assertEquals("2 days", DropText.windowLength(2880))
        assertEquals("2 hours", DropText.windowLength(120))
        assertEquals("45 minutes", DropText.windowLength(45))
        assertEquals(DropEntryStatusText("Winner", TagStyle.Success), DropText.entryStatus("won"))
        assertEquals("Not selected", DropText.entryStatus("lost").label)
        assertEquals("Window expired", DropText.entryStatus("expired").label)
        assertEquals("Entered", DropText.entryStatus("entered").label)
        assertEquals("Entered", DropText.entryStatus("something_new").label)
    }

    @Test fun dayTitles() {
        val zone = ZoneId.of("UTC")
        assertEquals("Today", DropText.dayTitle(now.atZone(zone).toLocalDate(), now, zone))
        assertEquals("Tomorrow", DropText.dayTitle(now.atZone(zone).toLocalDate().plusDays(1), now, zone))
        val later = DropText.dayTitle(now.atZone(zone).toLocalDate().plusDays(3), now, zone)
        assertTrue(later, later.isNotEmpty() && later != "Today" && later != "Tomorrow")
    }

    @Test fun reminderToasts() {
        assertEquals(DropToastMessage("Reminder removed", Toast.Style.Info), DropActions.reminderMessage(false, DropLocalReminder.Outcome.Removed))
        assertEquals("Reminder set. We'll alert you 10 minutes before it opens.", DropActions.reminderMessage(true, DropLocalReminder.Outcome.Scheduled).text)
        assertTrue(DropActions.reminderMessage(true, DropLocalReminder.Outcome.Denied).text.startsWith("Reminder set. Turn on notifications"))
        assertEquals("Reminder set", DropActions.reminderMessage(true, DropLocalReminder.Outcome.TooSoon).text)
        assertEquals("yard.drop-reminder.drp_1", DropLocalReminder.identifier("drp_1"))
    }
}
