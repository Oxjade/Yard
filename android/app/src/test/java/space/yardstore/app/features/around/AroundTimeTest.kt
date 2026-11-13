package space.yardstore.app.features.around

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class AroundTimeTest {
    private val hours = AroundFixtures.weekdayHours // Mon–Thu 10–19, Fri 10–21, Sat 11–21, Sun closed
    private fun at(iso: String): Instant = Instant.parse(iso)

    @Test fun localClockInPlaceZone() {
        // Friday 13 Nov 2026, 23:30 UTC = Saturday 00:30 in Lagos (UTC+1).
        assertEquals("sat" to 30, AroundTime.localClock(at("2026-11-13T23:30:00Z"), "Africa/Lagos"))
        assertEquals("fri" to 23 * 60 + 30, AroundTime.localClock(at("2026-11-13T23:30:00Z"), "UTC"))
        assertEquals("fri" to 0, AroundTime.localClock(at("2026-11-13T00:00:00Z"), "Not/AZone"))
    }

    @Test fun openNow() {
        val s = AroundTime.openState(hours, "Africa/Lagos", at("2026-11-13T12:00:00Z"))
        assertEquals(AroundOpenState.Open("21:00"), s)
        assertEquals("Open, closes 21:00", AroundTime.openLine(s))
        assertEquals("Open now, closes 21:00", AroundTime.openNowLine(s!!))
    }

    @Test fun closedOpensLaterToday() {
        val s = AroundTime.openState(hours, "Africa/Lagos", at("2026-11-16T07:00:00Z")) // Mon 08:00
        assertEquals("Closed, opens 10:00", AroundTime.openLine(s))
        assertEquals("Closed now, opens 10:00", AroundTime.openNowLine(s!!))
    }

    @Test fun closedOpensTomorrow() {
        val s = AroundTime.openState(hours, "Africa/Lagos", at("2026-11-13T21:30:00Z")) // Fri 22:30
        assertEquals("Closed, opens tomorrow 11:00", AroundTime.openLine(s))
        assertEquals("Closed now, opens tomorrow 11:00", AroundTime.openNowLine(s!!))
    }

    @Test fun closedOpensAnotherDay() {
        val s = AroundTime.openState(hours, "Africa/Lagos", at("2026-11-14T22:00:00Z")) // Sat 23:00
        assertEquals("Closed, opens Mon 10:00", AroundTime.openLine(s))
        assertEquals("Closed now, opens Monday 10:00", AroundTime.openNowLine(s!!))
    }

    @Test fun overnightAndMidnightRanges() {
        val late = AroundHours(mapOf("fri" to listOf(listOf("22:00", "02:00"))))
        assertEquals(AroundOpenState.Open("02:00"), AroundTime.openState(late, "UTC", at("2026-11-13T23:00:00Z")))
        assertEquals(AroundOpenState.Open("02:00"), AroundTime.openState(late, "UTC", at("2026-11-14T01:00:00Z")))
        val toMidnight = AroundHours(mapOf("fri" to listOf(listOf("18:00", "24:00"))))
        assertEquals(AroundOpenState.Open("midnight"), AroundTime.openState(toMidnight, "UTC", at("2026-11-13T20:00:00Z")))
    }

    @Test fun neverOpen() {
        val none = AroundHours(emptyMap())
        val s = AroundTime.openState(none, "UTC", at("2026-11-13T12:00:00Z"))
        assertEquals("Closed", AroundTime.openLine(s))
        assertEquals("Closed now", AroundTime.openNowLine(s!!))
        assertNull(AroundTime.openState(null, "UTC", at("2026-11-13T12:00:00Z")))
        assertNull(AroundTime.openLine(null))
    }

    @Test fun statusLinesForStores() {
        val store = AroundFixtures.store
        val open = AroundTime.statusLine(store, at("2026-11-13T12:00:00Z"))!!
        assertEquals("Open, closes 21:00", open.text)
        assertEquals(AroundStatusLine.Tone.Open, open.tone)
        assertTrue(AroundTime.isOpenNow(store, at("2026-11-13T12:00:00Z")))
        assertFalse(AroundTime.isOpenNow(store, at("2026-11-15T12:00:00Z")))

        val appt = store.copy(hours = null, byAppointment = true)
        assertEquals(AroundStatusLine("By appointment", AroundStatusLine.Tone.Neutral), AroundTime.statusLine(appt, at("2026-11-13T12:00:00Z")))
        val apptWithHours = store.copy(byAppointment = true)
        assertEquals("Open, closes 21:00, by appointment", AroundTime.statusLine(apptWithHours, at("2026-11-13T12:00:00Z"))!!.text)
        assertNull(AroundTime.statusLine(store.copy(hours = null), at("2026-11-13T12:00:00Z")))
    }

    @Test fun statusLinesForDatedPlaces() {
        val popup = AroundFixtures.popup.copy(startsAt = "2026-11-01T10:00:00.000Z", endsAt = "2026-11-20T18:00:00.000Z")
        val live = AroundTime.statusLine(popup, at("2026-11-13T12:00:00Z"))!!
        assertEquals("Live now, until Fri 20 Nov, 18:00", live.text)
        assertEquals(AroundStatusLine.Tone.Live, live.tone)
        assertEquals("Live now, until 18:00", AroundTime.statusLine(popup, at("2026-11-20T09:00:00Z"))!!.text)
        assertEquals("Ended", AroundTime.statusLine(popup, at("2026-11-21T00:00:00Z"))!!.text)
        assertEquals("Starts Sun 1 Nov, 10:00", AroundTime.statusLine(popup, at("2026-10-20T00:00:00Z"))!!.text)
        assertTrue(AroundTime.isOpenNow(popup, at("2026-11-13T12:00:00Z")))
        assertNull(AroundTime.statusLine(popup.copy(endsAt = null), at("2026-11-13T12:00:00Z")))
    }

    @Test fun nextEventLine() {
        val store = AroundFixtures.store.copy(
            nextEvent = AroundNextEvent("e", "Drop 07: Third Mainland", "2026-11-21T11:00:00.000Z", "2026-11-21T18:00:00.000Z"),
        )
        assertEquals("Drop 07: Third Mainland, Sat 21 Nov 12:00", AroundTime.nextEventLine(store, at("2026-11-13T12:00:00Z")))
        assertEquals("Drop 07: Third Mainland, on now", AroundTime.nextEventLine(store, at("2026-11-21T12:00:00Z")))
        assertNull(AroundTime.nextEventLine(store.copy(nextEvent = null), at("2026-11-13T12:00:00Z")))
    }

    @Test fun dateRanges() {
        assertEquals("Sat 7 – Sun 8 Nov", AroundTime.dateRange(at("2026-11-07T10:00:00Z"), at("2026-11-08T18:00:00Z"), "UTC"))
        assertEquals("Sat 7 Nov", AroundTime.dateRange(at("2026-11-07T10:00:00Z"), at("2026-11-07T18:00:00Z"), "UTC"))
        assertEquals("Sat 7 Nov", AroundTime.dateRange(at("2026-11-07T10:00:00Z"), at("2026-11-08T00:00:00Z"), "UTC"))
        assertEquals("Sat 31 Oct – Sun 1 Nov", AroundTime.dateRange(at("2026-10-31T10:00:00Z"), at("2026-11-01T18:00:00Z"), "UTC"))
        assertEquals("Sat 7 Nov, 11:00", AroundTime.dayTimeIn(at("2026-11-07T10:00:00Z"), "Africa/Lagos"))
    }

    @Test fun zonesAndDistance() {
        assertEquals("WAT", AroundTime.zoneShort("Africa/Lagos", at("2026-11-13T12:00:00Z")))
        assertEquals("SAST", AroundTime.zoneShort("Africa/Johannesburg", at("2026-11-13T12:00:00Z")))
        assertEquals("50 m", AroundTime.distance(20.0))
        assertEquals("850 m", AroundTime.distance(849.0))
        assertEquals("1.2 km", AroundTime.distance(1234.0))
        assertEquals("24 km", AroundTime.distance(24_400.0))
        assertEquals(10 * 60 + 30, AroundTime.toMinutes("10:30"))
        assertEquals(0, AroundTime.toMinutes("bad"))
    }
}
