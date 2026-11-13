package space.yardstore.app.features.inbox

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant
import java.time.ZoneOffset
import java.util.Locale

class InboxFormatTest {
    private val utc = ZoneOffset.UTC
    private val now = Instant.parse("2026-11-13T15:00:00Z")

    @Test fun dayLabels() {
        Locale.setDefault(Locale.UK)
        assertEquals("Today", InboxFormat.dayLabel(Instant.parse("2026-11-13T01:00:00Z"), now, utc))
        assertEquals("Yesterday", InboxFormat.dayLabel(Instant.parse("2026-11-12T23:00:00Z"), now, utc))
        assertEquals("Wed 4 Nov", InboxFormat.dayLabel(Instant.parse("2026-11-04T10:00:00Z"), now, utc))
        assertEquals("Thu 4 Dec 2025", InboxFormat.dayLabel(Instant.parse("2025-12-04T10:00:00Z"), now, utc))
    }

    @Test fun rowTimes() {
        Locale.setDefault(Locale.UK)
        assertEquals("", InboxFormat.rowTime("nope", now, utc))
        assertEquals("Yesterday", InboxFormat.rowTime("2026-11-12T10:00:00Z", now, utc))
        assertEquals("Tue", InboxFormat.rowTime("2026-11-10T10:00:00Z", now, utc))
    }

    @Test fun sentenceAvoidsDoubleStop() {
        assertEquals("You can't message Kumasi Thread Co.", InboxFormat.sentence("You can't message Kumasi Thread Co."))
        assertEquals("You can't message Acme.", InboxFormat.sentence("You can't message Acme "))
    }

    @Test fun disabledReasons() {
        assertNull(InboxFormat.disabledReason(null, "Acme"))
        assertNull(InboxFormat.disabledReason(InboxInteraction(canSend = true), "Acme"))
        fun r(reason: String?) = InboxFormat.disabledReason(InboxInteraction(canSend = false, reason = reason), "Acme")
        assertEquals("You can't message Acme.", r("blocked_by_them"))
        assertEquals("You blocked Acme. Unblock them from the menu to send a message.", r("blocked_by_me"))
        assertEquals("Messaging is paused on your account.", r("restricted"))
        assertEquals("This conversation was closed by Yard.", r("locked"))
        assertEquals("Acme isn't taking messages right now.", r("brand_unavailable"))
        assertEquals("You can't send messages here right now.", r("role"))
        Locale.setDefault(Locale.UK)
        val until = InboxFormat.disabledReason(InboxInteraction(false, "restricted", "2026-12-01T12:00:00Z"), "Acme")
        assertEquals("Messaging is paused on your account until 1 Dec 2026.", until)
    }

    @Test fun orderStatuses() {
        assertEquals("On its way", InboxFormat.orderStatus("shipped"))
        assertEquals("Return requested", InboxFormat.orderStatus("refund_requested"))
        assertEquals("Partially Shipped", InboxFormat.orderStatus("partially_shipped"))
    }
}
