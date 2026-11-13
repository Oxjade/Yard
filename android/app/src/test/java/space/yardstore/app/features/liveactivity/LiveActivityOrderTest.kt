package space.yardstore.app.features.liveactivity

import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import space.yardstore.app.core.models.YardJson
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.core.networking.PersistentCookieJar
import space.yardstore.app.features.liveactivity.YardOrderActivityAttributes.ContentState
import space.yardstore.app.features.liveactivity.YardOrderActivityAttributes.Step
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZoneOffset

private val ZONE: ZoneId = ZoneOffset.UTC

/** Realistic `GET /api/orders/{id}` body (OrderDetailDto, trimmed to what's modelled plus extras). */
private fun orderJson(fulfilment: String, deliveredAt: String? = null) = """
{"order":{"id":"ord_7Kq2","reference":"YD-4821-A","placedAt":"2026-11-08T10:12:00.000Z","currency":"GBP",
 "brand":{"id":"brd_ojue","name":"Ojuelegba Supply","handle":"ojuelegba","logoUrl":"/api/media/m_1"},
 "shipToPreview":{"city":"London","country":"GB"},
 "states":{"payment":"paid","fulfilment":"$fulfilment"},
 "deliveredAt":${if (deliveredAt == null) "null" else "\"$deliveredAt\""},
 "lines":[{"title":"Agbada Jacket","quantity":1,"unitPrice":12000}]}}
"""

private fun event(status: String, at: String) =
    """{"id":"evt_$status","status":"$status","occurredAt":"$at","carrier":"DHL","trackingNumber":"JD0123","locationText":null,"note":null,"source":"brand"}"""

/** Realistic `GET /api/orders/{id}/delivery` body (DeliveryDto). */
private fun deliveryJson(
    events: List<String>,
    arrivalFrom: String? = "2026-11-16",
    arrivalTo: String? = "2026-11-18",
    late: Boolean = false,
    basis: String = "estimate",
    deliveredOn: String? = null,
    shippedOn: String? = "2026-11-10",
    city: String? = "London",
) = """
{"orderId":"ord_7Kq2","reference":"YD-4821-A","brand":{"id":"brd_ojue","name":"Ojuelegba Supply"},"service":"standard",
 "shipTo":{"country":"GB","city":${city?.let { "\"$it\"" } ?: "null"}},"placedAt":"2026-11-08T10:12:00.000Z","sample":false,
 "estimate":{"basis":"$basis","arrivalFrom":${arrivalFrom?.let { "\"$it\"" } ?: "null"},"arrivalTo":${arrivalTo?.let { "\"$it\"" } ?: "null"},
   "deliveredOn":${deliveredOn?.let { "\"$it\"" } ?: "null"},"late":$late,"providerId":"p1","reason":null,"computedAt":"2026-11-10T09:00:00.000Z"},
 "placedEstimate":null,"shippedOn":${shippedOn?.let { "\"$it\"" } ?: "null"},
 "events":[${events.joinToString(",")}],"complaint":null}
"""

class LiveActivityOrderTest {
    private fun order(json: String) = YardJson.decodeFromString(LiveActivityOrderEnvelope.serializer(), json).order
    private fun delivery(json: String) = YardJson.decodeFromString(LiveActivityDeliveryDTO.serializer(), json)
    private val now: Instant = Instant.parse("2026-11-13T12:00:00Z")

    private fun make(fulfilment: String, delivery: LiveActivityDeliveryDTO?, brandCity: String = "Lagos", at: Instant = now, deliveredAt: String? = null) =
        LiveActivityOrder.make("ord_7Kq2", order(orderJson(fulfilment, deliveredAt)), delivery, brandCity, at, ZONE)

    // Decoding

    @Test fun decodesOrderEnvelope() {
        val o = order(orderJson("shipped"))!!
        assertEquals("ord_7Kq2", o.id)
        assertEquals("YD-4821-A", o.reference)
        assertEquals("Ojuelegba Supply", o.brand?.name)
        assertEquals("ojuelegba", o.brand?.handle)
        assertEquals("London", o.shipToPreview?.city)
        assertEquals("shipped", o.states?.fulfilment)
        assertNull(o.deliveredAt)
    }

    @Test fun decodesDelivery() {
        val d = delivery(deliveryJson(listOf(event("shipped", "2026-11-10T08:00:00.000Z")), late = true))
        assertEquals("2026-11-16", d.estimate?.arrivalFrom)
        assertEquals("2026-11-18", d.estimate?.arrivalTo)
        assertEquals(true, d.estimate?.late)
        assertEquals("2026-11-10", d.shippedOn)
        assertEquals("London", d.shipTo?.city)
        assertEquals(1, d.events?.size)
        assertEquals("shipped", d.events?.first()?.status)
    }

    @Test fun decodesStorefrontAndEmptyBodies() {
        val s = YardJson.decodeFromString(LiveActivityStorefrontDTO.serializer(), """{"brand":{"id":"brd_ojue","name":"Ojuelegba Supply","city":"Lagos","country":"NG"},"version":{}}""")
        assertEquals("Lagos", s.brand?.city)
        assertNull(YardJson.decodeFromString(LiveActivityOrderEnvelope.serializer(), "{}").order)
        val d = YardJson.decodeFromString(LiveActivityDeliveryDTO.serializer(), """{"estimate":null,"events":null,"shipTo":{"country":"GB","city":null}}""")
        assertNull(d.estimate)
        assertNull(d.shipTo?.city)
    }

    // Mapping

    @Test fun cancelledAndReturnedClose() {
        assertTrue(make("cancelled", null).isClosed)
        assertTrue(make("returned_to_sender", null).isClosed)
        val returned = make("shipped", delivery(deliveryJson(listOf(event("shipped", "2026-11-10T08:00:00Z"), event("returned", "2026-11-12T08:00:00Z")))))
        assertTrue(returned.isClosed)
        assertNull(returned.state)
    }

    @Test fun deliveredFromAnySignal() {
        assertEquals(Step.Delivered, make("delivered", null).state?.step)
        assertEquals(Step.Delivered, make("shipped", delivery(deliveryJson(listOf(event("delivered", "2026-11-12T08:00:00Z"))))).state?.step)
        assertEquals(Step.Delivered, make("shipped", delivery(deliveryJson(emptyList(), deliveredOn = "2026-11-12"))).state?.step)
        val s = make("shipped", null, deliveredAt = "2026-11-12T08:00:00Z").state!!
        assertEquals(Step.Delivered, s.step)
        assertEquals("Delivered", s.statusLine)
        assertEquals(1.0, s.progress, 0.0)
        assertNull(s.etaDate)
    }

    @Test fun outForDeliveryUsesDeliveryCity() {
        val d = delivery(deliveryJson(listOf(event("shipped", "2026-11-10T08:00:00Z"), event("out_for_delivery", "2026-11-13T07:00:00Z"))))
        val r = make("shipped", d)
        val s = r.state!!
        assertEquals(Step.OutForDelivery, s.step)
        assertEquals("Out for delivery in London", s.statusLine)
        assertEquals(0.86, s.progress, 1e-9)
        assertEquals(LocalDateTime.of(2026, 11, 18, 20, 0).toInstant(ZoneOffset.UTC), s.etaDate)
        assertEquals("London", r.deliveryCity)
        assertEquals("Lagos", r.brandCity)
        assertEquals("Ojuelegba Supply", r.brandName)
    }

    @Test fun outForDeliveryWithoutCity() {
        val d = delivery(deliveryJson(listOf(event("out_for_delivery", "2026-11-13T07:00:00Z")), city = null))
        val o = LiveActivityOrder.make("o", null, d, "", now, ZONE)
        assertEquals("Out for delivery", o.state?.statusLine)
        assertEquals("The brand", o.brandName)
    }

    @Test fun eventsAreSortedByTimeBeforeReadingTheLatest() {
        // Out of order on the wire: sorted by time, out_for_delivery is the latest.
        val d = delivery(deliveryJson(listOf(event("out_for_delivery", "2026-11-13T07:00:00Z"), event("shipped", "2026-11-10T08:00:00Z"))))
        assertEquals(Step.OutForDelivery, make("shipped", d).state?.step)
    }

    @Test fun shippedProgressIsTimeBased() {
        // Shipped 10 Nov 08:00Z, ETA 18 Nov 20:00Z; now 13 Nov 12:00Z.
        val d = delivery(deliveryJson(listOf(event("shipped", "2026-11-10T08:00:00Z"))))
        val s = make("shipped", d).state!!
        assertEquals(Step.Shipped, s.step)
        assertEquals("On its way from Lagos", s.statusLine)
        val start = Instant.parse("2026-11-10T08:00:00Z").toEpochMilli().toDouble()
        val end = Instant.parse("2026-11-18T20:00:00Z").toEpochMilli().toDouble()
        val expected = 0.25 + 0.53 * ((now.toEpochMilli() - start) / (end - start))
        assertEquals(expected, s.progress, 1e-9)
    }

    @Test fun shippedFallsBackToShippedOnAndBaseProgress() {
        val noEta = delivery(deliveryJson(listOf(event("in_transit", "2026-11-11T08:00:00Z")), arrivalFrom = null, arrivalTo = null))
        val s = make("processing", noEta, brandCity = "").state!!
        assertEquals(Step.Shipped, s.step)
        assertEquals("On its way", s.statusLine)
        assertEquals(0.25, s.progress, 1e-9)
        assertNull(s.etaDate)
        // fulfilment "shipped" with no events uses shippedOn (local midnight) as the start.
        val viaShippedOn = make("shipped", delivery(deliveryJson(emptyList()))).state!!
        assertTrue(viaShippedOn.progress > 0.25 && viaShippedOn.progress < 0.78)
    }

    @Test fun shippedLinesForExceptionAndLate() {
        val exception = delivery(deliveryJson(listOf(event("shipped", "2026-11-10T08:00:00Z"), event("exception", "2026-11-12T08:00:00Z"))))
        assertEquals("Delayed — Ojuelegba Supply reported a delay", make("shipped", exception).state?.statusLine)
        val late = delivery(deliveryJson(listOf(event("shipped", "2026-11-10T08:00:00Z")), late = true))
        assertEquals("Running late — new estimate", make("shipped", late).state?.statusLine)
        val lateBasis = delivery(deliveryJson(listOf(event("shipped", "2026-11-10T08:00:00Z")), basis = "late"))
        assertEquals("Running late — new estimate", make("shipped", lateBasis).state?.statusLine)
    }

    @Test fun arrivingSoonOnceArrivalWindowOpens() {
        val d = delivery(deliveryJson(listOf(event("shipped", "2026-11-10T08:00:00Z")), arrivalFrom = "2026-11-13"))
        val s = make("shipped", d).state!!
        assertEquals(Step.ArrivingSoon, s.step)
        assertEquals("Arriving soon in London", s.statusLine)
        assertTrue(s.progress >= 0.7)
        val lateD = delivery(deliveryJson(listOf(event("shipped", "2026-11-10T08:00:00Z")), arrivalFrom = "2026-11-13", late = true))
        assertEquals("Running late — arriving soon in London", make("shipped", lateD).state?.statusLine)
    }

    @Test fun packedAndNothingYet() {
        val packed = make("processing", null).state!!
        assertEquals(Step.Packed, packed.step)
        assertEquals("Packed by Ojuelegba Supply", packed.statusLine)
        assertEquals(0.08, packed.progress, 1e-9)
        val label = make("unfulfilled", delivery(deliveryJson(listOf(event("label_created", "2026-11-09T08:00:00Z"))))).state
        assertEquals(Step.Packed, label?.step)
        val none = make("unfulfilled", null)
        assertNull(none.state)
        assertFalse(none.isClosed)
    }

    // Helpers

    @Test fun calendarDates() {
        assertEquals(Instant.parse("2026-11-16T00:00:00Z"), LiveActivityDates.startOfDay("2026-11-16", ZONE))
        assertEquals(Instant.parse("2026-11-16T00:00:00Z"), LiveActivityDates.startOfDay("2026-11-16T15:30:00.000Z", ZONE))
        assertEquals(Instant.parse("2026-11-16T20:00:00Z"), LiveActivityDates.endOfArrivalDay("2026-11-16", ZONE))
        assertNull(LiveActivityDates.startOfDay("2026-11", ZONE))
        assertNull(LiveActivityDates.startOfDay("not-a-date", ZONE))
        assertNull(LiveActivityDates.endOfArrivalDay(null, ZONE))
    }

    @Test fun contentStateClampsProgressAndUpcomingEta() {
        val s = ContentState(Step.Shipped, now.plusSeconds(60), 1.7, "x")
        assertEquals(1.0, s.progress, 0.0)
        assertEquals(0.0, ContentState(Step.Shipped, null, -2.0, "x").progress, 0.0)
        assertTrue(s.hasUpcomingETA(now))
        assertFalse(ContentState(Step.Delivered, now.plusSeconds(60), 1.0, "x").hasUpcomingETA(now))
        assertFalse(ContentState(Step.Shipped, now.minusSeconds(60), 0.5, "x").hasUpcomingETA(now))
        assertEquals(s, ContentState(Step.Shipped, now.plusSeconds(60), 1.0, "x"))
    }

    @Test fun stepRawValuesMatchIOS() {
        assertEquals(listOf("packed", "shipped", "outForDelivery", "arrivingSoon", "delivered"), Step.entries.map { it.raw })
        assertEquals(Step.OutForDelivery, Step.fromRaw("outForDelivery"))
        assertNull(Step.fromRaw("nope"))
        assertEquals("Out for delivery", Step.OutForDelivery.title)
    }

    @Test fun etaKinds() {
        val delivered = ContentState(Step.Delivered, null, 1.0, "Delivered")
        assertEquals(OrderETA.Delivered, OrderETA.of(delivered, now))
        assertEquals("Delivered", orderETACaption(delivered, now))
        val unknown = ContentState(Step.Shipped, null, 0.3, "x")
        assertEquals(OrderETA.Unknown, OrderETA.of(unknown, now))
        assertEquals("Estimate pending", orderETACaption(unknown, now))
        assertEquals("—", orderETAFigure(unknown, now))
        val past = ContentState(Step.Shipped, now.minusSeconds(1), 0.3, "x")
        assertEquals(OrderETA.Unknown, OrderETA.of(past, now))
        val soon = ContentState(Step.OutForDelivery, now.plusSeconds(5 * 3600 + 11 * 60), 0.86, "x")
        assertTrue(OrderETA.of(soon, now) is OrderETA.Countdown)
        assertEquals("5h 11m", orderETAFigure(soon, now))
        assertTrue(orderETACaption(soon, now).startsWith("Arrives by "))
        assertEquals("45m", orderETAFigure(ContentState(Step.OutForDelivery, now.plusSeconds(45 * 60), 0.9, "x"), now))
        val exactly24h = ContentState(Step.Shipped, now.plusSeconds(24 * 3600), 0.5, "x")
        assertTrue(OrderETA.of(exactly24h, now) is OrderETA.Countdown)
        val later = ContentState(Step.Shipped, now.plusSeconds(2 * 86_400 + 3 * 3600), 0.5, "x")
        assertEquals(OrderETA.Days(3, now.plusSeconds(2 * 86_400 + 3 * 3600)), OrderETA.of(later, now))
        assertEquals("3 days", orderETAFigure(later, now))
        assertEquals("2 days", orderETAFigure(ContentState(Step.Shipped, now.plusSeconds(86_400 + 1), 0.5, "x"), now))
    }
}

/** `LiveActivityOrder.load` against MockWebServer: the three real endpoints. */
class LiveActivityOrderLoadTest {
    private lateinit var server: MockWebServer
    private lateinit var api: APIClient
    private val routes = mutableMapOf<String, MockResponse>()

    @Before fun setUp() {
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse =
                routes[request.path] ?: MockResponse().setResponseCode(404).setBody("""{"error":{"code":"not_found","message":"We couldn't find that order."}}""")
        }
        server.start()
        // Relative API paths resolve to production; rewrite them onto the mock server.
        val http = APIClient.buildHttpClient(PersistentCookieJar(null)).newBuilder()
            .addInterceptor { chain ->
                val req = chain.request()
                val url = req.url.newBuilder().scheme("http").host(server.hostName).port(server.port).build()
                chain.proceed(req.newBuilder().url(url).build())
            }
            .build()
        api = APIClient(http)
    }

    @After fun tearDown() = server.shutdown()

    private val now = Instant.parse("2026-11-13T12:00:00Z")

    @Test fun loadsOrderDeliveryAndBrandCity() = runTest {
        routes["/api/orders/ord_7Kq2"] = MockResponse().setBody(orderJson("shipped"))
        routes["/api/orders/ord_7Kq2/delivery"] = MockResponse().setBody(deliveryJson(listOf(event("shipped", "2026-11-10T08:00:00Z"))))
        routes["/api/catalog/storefronts/ojuelegba"] = MockResponse().setBody("""{"brand":{"id":"brd_ojue","name":"Ojuelegba Supply","city":"Lagos"}}""")
        val o = LiveActivityOrder.load("ord_7Kq2", now = now, api = api)
        assertEquals("Lagos", o.brandCity)
        assertEquals("London", o.deliveryCity)
        assertEquals(Step.Shipped, o.state?.step)
        assertEquals("On its way from Lagos", o.state?.statusLine)
        val paths = (1..3).map { server.takeRequest().path }.toSet()
        assertEquals(setOf("/api/orders/ord_7Kq2", "/api/orders/ord_7Kq2/delivery", "/api/catalog/storefronts/ojuelegba"), paths)
    }

    @Test fun knownBrandCitySkipsStorefrontAndDeliveryFailureIsTolerated() = runTest {
        routes["/api/orders/ord_7Kq2"] = MockResponse().setBody(orderJson("processing"))
        routes["/api/orders/ord_7Kq2/delivery"] = MockResponse().setResponseCode(500).setBody("""{"error":{"code":"internal","message":"Boom"}}""")
        val o = LiveActivityOrder.load("ord_7Kq2", knownBrandCity = "Accra", now = now, api = api)
        assertEquals("Accra", o.brandCity)
        assertEquals(Step.Packed, o.state?.step)
        assertEquals("London", o.deliveryCity) // from shipToPreview
        assertEquals(2, server.requestCount)
    }

    @Test fun storefrontFailureLeavesCityEmpty() = runTest {
        routes["/api/orders/ord_7Kq2"] = MockResponse().setBody(orderJson("shipped"))
        routes["/api/orders/ord_7Kq2/delivery"] = MockResponse().setBody(deliveryJson(listOf(event("shipped", "2026-11-10T08:00:00Z"))))
        val o = LiveActivityOrder.load("ord_7Kq2", now = now, api = api)
        assertEquals("", o.brandCity)
        assertEquals("On its way", o.state?.statusLine)
    }

    @Test fun missingOrderThrowsNotFound() = runTest {
        try {
            LiveActivityOrder.load("ord_gone", now = now, api = api)
            fail("expected APIError")
        } catch (e: APIError) {
            assertTrue(e.isNotFound)
            assertEquals("We couldn't find that order.", e.message)
        }
    }

    @Test fun encodesOrderIdInPath() = runTest {
        routes["/api/orders/a%20b"] = MockResponse().setBody(orderJson("unfulfilled"))
        routes["/api/orders/a%20b/delivery"] = MockResponse().setBody(deliveryJson(emptyList(), shippedOn = null))
        routes["/api/catalog/storefronts/ojuelegba"] = MockResponse().setBody("""{"brand":{"city":"Lagos"}}""")
        val o = LiveActivityOrder.load("a b", now = now, api = api)
        assertNotNull(o)
        assertNull(o.state)
        assertEquals("a b", o.orderId)
    }
}
