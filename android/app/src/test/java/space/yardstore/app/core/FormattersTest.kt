package space.yardstore.app.core

import org.junit.Assert.assertEquals
import org.junit.Test
import space.yardstore.app.core.models.Money
import space.yardstore.app.core.models.MoneyFormatter
import space.yardstore.app.core.models.YardDate
import java.time.Instant
import java.time.ZoneOffset

class FormattersTest {
    @Test fun money() {
        assertEquals("$45", Formatters.price(4500, "USD"))
        assertEquals("$45.50", Formatters.price(4550, "USD"))
        assertEquals("$45.00", Formatters.price(4500, "USD", showCents = true))
        assertEquals("$1,250", Formatters.price(125_000, "usd"))
        assertEquals("₦12,000", Formatters.price(1_200_000, "NGN"))
        assertEquals("MX$640", Formatters.price(64_000, "MXN"))
        assertEquals("KSh8,296", Formatters.price(829_600, "KES"))
        assertEquals("¥4,500", Formatters.price(4500, "JPY"))
        assertEquals("£9.99", Money(999, "GBP").formatted)
        assertEquals("$1.2K", MoneyFormatter.format(123_400, "USD", compact = true))
        assertEquals(45.0, MoneyFormatter.toMajor(4500, "USD"), 0.0)
        assertEquals(4500.0, MoneyFormatter.toMajor(4500, "JPY"), 0.0)
    }

    @Test fun counts() {
        assertEquals("252", Formatters.count(252))
        assertEquals("1.2K", Formatters.count(1234))
        assertEquals("24K", Formatters.count(24_000))
        assertEquals("3.4M", Formatters.count(3_400_000))
        assertEquals("1B", Formatters.count(1_000_000_000))
        assertEquals("-1.5K", Formatters.compactNumber(-1500.0))
    }

    @Test fun countdown() {
        assertEquals("00:00:00", Formatters.countdown(-5.0))
        assertEquals("00:01:05", Formatters.countdown(65.0))
        assertEquals("04:12:09", Formatters.countdown(4 * 3600 + 12 * 60 + 9.0))
        assertEquals("2d 04:12:09", Formatters.countdown(2 * 86_400 + 4 * 3600 + 12 * 60 + 9.0))
    }

    @Test fun relative() {
        val now = Instant.parse("2026-11-13T12:00:00Z")
        val z = ZoneOffset.UTC
        assertEquals("Just now", Formatters.relative(now.minusSeconds(30), now, z))
        assertEquals("5m ago", Formatters.relative(now.minusSeconds(300), now, z))
        assertEquals("3h ago", Formatters.relative(now.minusSeconds(3 * 3600), now, z))
        assertEquals("Yesterday", Formatters.relative(now.minusSeconds(30 * 3600), now, z))
        assertEquals("4d ago", Formatters.relative(now.minusSeconds(4 * 86_400), now, z))
        assertEquals("in 5m", Formatters.future(now.plusSeconds(300), now, z))
        assertEquals("in 3h", Formatters.future(now.plusSeconds(3 * 3600), now, z))
        assertEquals("in 20h", Formatters.future(now.plusSeconds(20 * 3600), now, z))
        assertEquals("Tomorrow", Formatters.future(now.plusSeconds(25 * 3600), now, z))
        assertEquals("in 3d", Formatters.future(now.plusSeconds(3 * 86_400), now, z))
        assertEquals("Now", Formatters.future(now.minusSeconds(1), now, z))
    }

    @Test fun dates() {
        assertEquals(Instant.parse("2026-11-13T19:32:00Z"), YardDate.parse("2026-11-13T19:32:00.000Z"))
        assertEquals(Instant.parse("2026-11-13T19:32:00Z"), YardDate.parse("2026-11-13T19:32:00Z"))
        assertEquals(Instant.parse("2026-11-13T18:32:00Z"), YardDate.parse("2026-11-13T19:32:00+01:00"))
        assertEquals(Instant.parse("2026-11-13T00:00:00Z"), YardDate.parse("2026-11-13"))
        assertEquals(null, YardDate.parse("not a date"))
        assertEquals(null, YardDate.parse(null))
    }

    @Test fun config() {
        assertEquals(null, Config.url(null))
        assertEquals(null, Config.url("  "))
        assertEquals("https://yardstore.space/api/media/abc?w=600", Config.url("/api/media/abc?w=600"))
        assertEquals("https://yardstore.space/site/x.jpg", Config.url("site/x.jpg"))
        assertEquals("https://cdn.example.com/a.png", Config.url("//cdn.example.com/a.png"))
        assertEquals("http://x.test/a", Config.url("http://x.test/a"))
        assertEquals("/api/media/a%20b", Config.mediaPath("a b"))
        assertEquals("https://yardstore.space/brands/acme", Config.webUrl("/brands/acme"))
        assertEquals("https://yardstore.space", Config.origin)
    }
}
