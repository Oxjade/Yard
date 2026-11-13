package space.yardstore.app.features.home

import org.junit.Assert.assertEquals
import org.junit.Test
import space.yardstore.app.core.Formatters
import space.yardstore.app.core.models.Drop
import java.time.Duration
import java.time.Instant

class HomeDropCountdownTest {
    private val now: Instant = Instant.parse("2026-11-13T12:00:00Z")
    private fun at(seconds: Long) = now.plusSeconds(seconds).toString()
    private fun cd(seconds: Long) = Formatters.countdown(Duration.ofSeconds(seconds))

    @Test fun liveDropCountsToItsEnd() {
        assertEquals("Ends in ${cd(3_600)}", HomeDropCountdown.label(Drop(id = "d", phase = "live", endsAt = at(3_600)), now))
        assertEquals("Ending", HomeDropCountdown.label(Drop(id = "d", phase = "live", endsAt = at(-5)), now))
        assertEquals("Live now", HomeDropCountdown.label(Drop(id = "d", phase = "live", endsAt = ""), now))
    }

    @Test fun drawCountsToEntriesOpeningThenClosing() {
        val draw = Drop(id = "d", access = "draw", phase = "scheduled", startsAt = at(90_000), entryOpensAt = at(600), entryClosesAt = at(7_200))
        assertEquals("Entries open in ${cd(600)}", HomeDropCountdown.label(draw, now))
        val open = draw.copy(entryOpensAt = at(-60))
        assertEquals("Entries close in ${cd(7_200)}", HomeDropCountdown.label(open, now))
        val closed = open.copy(entryClosesAt = at(-1))
        assertEquals("Starts in ${cd(90_000)}", HomeDropCountdown.label(closed, now))
    }

    @Test fun upcomingCountsToStart() {
        assertEquals("Starts in ${cd(90_000)}", HomeDropCountdown.label(Drop(id = "d", startsAt = at(90_000)), now))
        assertEquals("Live now", HomeDropCountdown.label(Drop(id = "d", startsAt = at(-10)), now))
        assertEquals("Coming soon", HomeDropCountdown.label(Drop(id = "d", startsAt = ""), now))
    }

    @Test fun firstComeIgnoresEntryDates() {
        val drop = Drop(id = "d", access = "first_come", startsAt = at(100), entryOpensAt = at(50))
        assertEquals("Starts in ${cd(100)}", HomeDropCountdown.label(drop, now))
    }
}
