package space.yardstore.app.features.orders

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import space.yardstore.app.core.models.YardJson
import java.time.Instant
import java.time.ZoneOffset
import java.util.Locale

/** DTO decoding, text helpers, timeline, tracking snapshot and grouping. */
class OrderHelpersTest {
    init {
        Locale.setDefault(Locale.UK)
    }

    // region DTOs

    @Test fun decodesOrdersPageAndSkipsMalformedRows() {
        val json = OrderFixtures.pageJson(
            OrderFixtures.summaryJson(id = "ord_1"),
            """{ "reference": "no id" }""",
            "42",
            OrderFixtures.summaryJson(id = "ord_2", merchant = "mystery_state"),
            nextCursor = "2026-11-01T00:00:00.000Z|ord_2",
        )
        val page = YardJson.decodeFromString(OrdersPage.serializer(), json)
        assertEquals(listOf("ord_1", "ord_2"), page.items.map { it.id })
        assertEquals("2026-11-01T00:00:00.000Z|ord_2", page.nextCursor)
        val first = page.items[0]
        assertEquals("Acme Studio", first.brand.name)
        assertEquals("chk_1", first.groupKey)
        assertEquals(OrderStatus.Shipped, first.status)
        assertEquals("none", first.states.returnState)
        // Unknown merchant state reads as awaiting payment, as on the website.
        assertEquals(OrderStatus.PendingPayment, page.items[1].status)
    }

    @Test fun summaryDefaultsAndItemsTitle() {
        val s = OrderFixtures.summary("""{ "id": "ord_9", "checkoutId": null, "groupReference": "YRD-1", "itemCount": 1, "states": null }""")
        assertEquals("The brand", s.brand.name)
        assertEquals("USD", s.currency)
        assertEquals(OrderStatus.PendingPayment, s.status)
        assertEquals("YRD-1", s.groupKey)
        assertEquals("1 item", s.itemsTitle)

        val many = OrderFixtures.summary(OrderFixtures.summaryJson())
        assertEquals("Boxy tee and 2 more", many.itemsTitle)
        assertEquals("3 items", many.itemsCountText)
    }

    @Test fun decodesOrderDetailWithDeliveryAndTimeline() {
        val d = OrderFixtures.detail()
        assertEquals("ord_1", d.id)
        assertEquals("YRD-48213-1", d.summary.reference)
        assertEquals(2, d.lines.size) // the malformed line is skipped
        assertEquals("/api/media/abc", d.lines[0].imageUrl)
        assertNull(d.lines[1].imageUrl)
        assertEquals(1, d.lines[1].returnableQty)
        assertEquals("Ada Obi\n12 Example Road\nLondon, E1 6AN\nUnited Kingdom\n+44 20 0000 0000", d.shipTo!!.formatted)
        assertEquals(5, d.timeline.size)
        assertEquals(listOf("Order placed", "Payment confirmed", "Order being prepared", "Order shipped"), d.timeline.mapNotNull { it.label })
        assertEquals(OrderTracking("JD0147", "DHL"), d.tracking)
        assertEquals("2026-11-19", d.delivery!!.estimate!!.arrivalTo)
        assertEquals("In transit", d.delivery!!.events[1].label)
        assertFalse(d.actions.canCancel)
        assertNotNull(d.eventDate("fulfilment.shipped"))
    }

    @Test fun eventLabelsAndShipmentLabels() {
        assertEquals("You cancelled this order", OrderEvent(kind = "order.cancelled", data = OrderEventData("shopper")).label)
        assertEquals("Order cancelled", OrderEvent(kind = "order.cancelled").label)
        assertNull(OrderEvent(kind = "ledger.posted").label)
        assertEquals("Delayed", ShipmentEvent(status = "exception").label)
        assertEquals("Held At Customs", ShipmentEvent(status = "held_at_customs").label)
    }

    @Test fun checkoutFlagsAndPaymentMethod() {
        val paid = YardJson.decodeFromString(OrderCheckout.serializer(), OrderFixtures.checkoutJson())
        assertTrue(paid.isPaid)
        assertFalse(paid.isPending)
        assertEquals("Card", paid.payment?.methodLabel)
        val abandoned = YardJson.decodeFromString(OrderCheckout.serializer(), OrderFixtures.checkoutJson("pending_payment", "abandoned", "bank_transfer"))
        assertTrue(abandoned.isPending)
        assertTrue(abandoned.isAbandoned)
        assertEquals("Bank transfer", abandoned.payment?.methodLabel)
        assertTrue(OrderCheckout(status = "expired").isFailed)
        assertEquals("Pay With Bank", OrderCheckoutPayment(channel = "pay_with_bank").methodLabel)
    }

    @Test fun requestBodiesEncodeLikeTheWebsite() {
        val body = OrderReturnBody(listOf(OrderReturnLineBody("var_1", 1)), OrderReturnReason.TooSmall.rawValue, "", "return_abc12345")
        assertEquals(
            """{"lines":[{"variantId":"var_1","qty":1}],"reason":"too_small","note":"","idempotencyKey":"return_abc12345"}""",
            YardJson.encodeToString(OrderReturnBody.serializer(), body),
        )
        val key = OrderText.idempotencyKey("cancel")
        assertTrue(key, Regex("^[A-Za-z0-9_-]{8,80}$").matches(key))
    }

    // endregion

    // region Text

    @Test fun rangesAndDays() {
        assertEquals("16 Nov", OrderText.day("2026-11-16"))
        assertEquals("Mon 16 Nov", OrderText.weekdayDay("2026-11-16"))
        assertEquals("16–19 Nov", OrderText.range("2026-11-16", "2026-11-19"))
        assertEquals("30 Nov – 2 Dec", OrderText.range("2026-11-30", "2026-12-02"))
        assertEquals("16 Nov", OrderText.range("2026-11-16", "2026-11-16"))
        assertEquals("19 Nov", OrderText.range(null, "2026-11-19"))
        assertNull(OrderText.range(null, null))
    }

    @Test fun placesAndCountries() {
        assertEquals("Nigeria", OrderText.countryName("NG"))
        assertNull(OrderText.countryName(" "))
        assertEquals("Lagos, Nigeria", OrderText.place("Lagos", "NG"))
        assertEquals("Nigeria", OrderText.place("", "NG"))
        assertNull(OrderText.place(null, null))
    }

    @Test fun stampsTodayYesterdayAndOlder() {
        val zone = ZoneOffset.UTC
        val now = Instant.parse("2026-11-13T22:00:00Z")
        assertTrue(OrderText.stamp(Instant.parse("2026-11-13T21:44:00Z"), now, zone).startsWith("Today at "))
        assertTrue(OrderText.stamp(Instant.parse("2026-11-12T09:10:00Z"), now, zone).startsWith("Yesterday at "))
        assertTrue(OrderText.stamp(Instant.parse("2026-11-01T18:00:00Z"), now, zone).startsWith("1 Nov at "))
        assertEquals("12 Nov 2026", OrderText.longDate(Instant.parse("2026-11-12T10:00:00Z"), zone))
    }

    @Test fun trackingUrlsFollowTheSite() {
        assertTrue(OrderText.trackingUrl("JD 1", "DHL Express").startsWith("https://www.dhl.com/"))
        assertTrue(OrderText.trackingUrl("JD 1", "DHL Express").endsWith("tracking-id=JD%201"))
        assertEquals("https://www.ups.com/track?tracknum=1Z", OrderText.trackingUrl("1Z", "UPS"))
        assertEquals("https://www.royalmail.com/track-your-item#/tracking-results/AB1", OrderText.trackingUrl("AB1", "Royal Mail"))
        assertEquals("https://parcelsapp.com/en/tracking/X1", OrderText.trackingUrl("X1", null))
        assertEquals("Express", OrderText.serviceLabel("express"))
        assertEquals("Standard", OrderText.serviceLabel("anything"))
    }

    @Test fun statusWording() {
        assertEquals("On its way", OrderStatus.from("shipped").label)
        assertFalse(OrderStatus.Delivered.isOpen)
        assertTrue(OrderStatus.RefundRequested.isOpen)
        assertEquals("Cancelled before it was paid, so nothing was charged.", OrderStatusText.note(OrderStatus.Cancelled, "failed"))
        assertEquals(OrderStatus.Paid.note, OrderStatusText.note(OrderStatus.Paid, "paid"))
        assertEquals("Payment status: partially refunded.", OrderStatusText.payment("partially_refunded"))
        val paid = OrderFixtures.summary(OrderFixtures.summaryJson())
        val failed = OrderFixtures.summary(OrderFixtures.summaryJson(id = "ord_2", payment = "failed"))
        val pending = OrderFixtures.summary(OrderFixtures.summaryJson(id = "ord_3", payment = "pending"))
        assertEquals("Payment confirmed", OrderStatusText.groupPayment(listOf(paid)))
        assertEquals("Payment didn’t go through", OrderStatusText.groupPayment(listOf(paid, failed)))
        assertEquals("Awaiting payment confirmation", OrderStatusText.groupPayment(listOf(paid, pending)))
    }

    @Test fun returnCopyAndLines() {
        val d = OrderFixtures.detail()
        assertEquals("This order is within its return window.", OrderReturnText.window(d))
        val windowed = d.copy(actions = OrderActions(canRequestReturn = true, returnWindowEndsAt = "2026-12-01T00:00:00.000Z"))
        assertTrue(OrderReturnText.window(windowed).startsWith("This order is within its return window, until "))
        assertEquals("Your return was declined: Worn.", OrderReturnText.outcome(OrderReturn(status = "rejected", decisionReason = "Worn")))
        assertEquals("Your return request expired.", OrderReturnText.outcome(OrderReturn(status = "expired")))
        assertEquals(
            listOf(OrderReturnLineBody("var_2", 1)),
            OrderReturnText.lines(d, mapOf("var_1" to 0, "var_2" to 1, "var_unknown" to 3)),
        )
    }

    // endregion

    // region Timeline

    private fun withStates(merchant: String, payment: String, fulfilment: String, base: OrderDetail = OrderFixtures.detail()): OrderDetail =
        base.copy(summary = base.summary.copy(states = OrderStates(merchant, payment, fulfilment)))

    @Test fun timelineWhileShipped() {
        val steps = OrderTimelineBuilder.steps(OrderFixtures.detail())
        assertEquals(listOf("paid", "packed", "shipped", "out", "delivered"), steps.map { it.id })
        assertEquals(
            listOf(OrderTimelineStep.Progress.Done, OrderTimelineStep.Progress.Done, OrderTimelineStep.Progress.Current, OrderTimelineStep.Progress.Upcoming, OrderTimelineStep.Progress.Upcoming),
            steps.map { it.state },
        )
        assertEquals("Your parcel is with the carrier. Last seen in Heathrow.", steps[2].detail)
        assertNotNull(steps[2].date)
        assertNull(steps[3].date)
    }

    @Test fun timelineOutForDeliveryAndDelivered() {
        val base = OrderFixtures.detail()
        val out = base.copy(delivery = base.delivery!!.copy(events = base.delivery!!.events + ShipmentEvent(status = "out_for_delivery", occurredAt = "2026-11-16T07:00:00.000Z")))
        assertEquals(OrderTimelineStep.Progress.Current, OrderTimelineBuilder.steps(out).first { it.id == "out" }.state)

        val delivered = withStates("delivered", "paid", "delivered").copy(deliveredAt = "2026-11-17T12:00:00.000Z")
        val steps = OrderTimelineBuilder.steps(delivered)
        assertTrue(steps.all { it.state == OrderTimelineStep.Progress.Done })
        assertEquals("Something not right? You can request a return.", steps.last().detail)
    }

    @Test fun timelineAwaitingPayment() {
        val base = OrderFixtures.detail()
        val pending = withStates("pending_payment", "pending", "unfulfilled", base.copy(paidAt = null, timeline = emptyList()))
        val steps = OrderTimelineBuilder.steps(pending)
        assertEquals("Awaiting payment", steps[0].title)
        assertEquals(OrderTimelineStep.Progress.Current, steps[0].state)
        assertTrue(steps.drop(1).all { it.state == OrderTimelineStep.Progress.Upcoming })
    }

    @Test fun timelineStopsWhenCancelledOrFailed() {
        val base = OrderFixtures.detail().copy(delivery = null)
        val cancelled = withStates("cancelled", "refunded", "cancelled", base.copy(timeline = base.timeline.take(2), cancelledAt = "2026-11-11T10:00:00.000Z"))
        val steps = OrderTimelineBuilder.steps(cancelled)
        assertEquals(listOf("paid", "cancelled"), steps.map { it.id })
        assertEquals(OrderTimelineStep.Progress.Stopped, steps.last().state)
        assertEquals("Cancelled before it shipped, and marked refunded to your original payment method.", steps.last().detail)

        val failed = withStates("pending_payment", "failed", "unfulfilled", base.copy(paidAt = null, timeline = emptyList()))
        val failedSteps = OrderTimelineBuilder.steps(failed)
        assertEquals(listOf("failed"), failedSteps.map { it.id })
        assertEquals("Payment didn’t go through", failedSteps[0].title)
    }

    // endregion

    // region Tracking snapshot

    @Test fun snapshotOnlyOnceShipped() {
        assertNull(OrderTrackingSnapshot.from(withStates("paid", "paid", "unfulfilled"), null))
        val now = Instant.parse("2026-11-16T00:00:00Z")
        val s = OrderTrackingSnapshot.from(OrderFixtures.detail(), "Lagos", now)!!
        assertEquals("On its way", s.statusLabel)
        assertEquals("16–19 Nov", s.etaTitle)
        assertEquals("Estimated arrival", s.etaCaption)
        assertEquals("Lagos", s.originLabel)
        assertEquals("London", s.destinationLabel)
        assertEquals("Shipped 13 Nov", s.originDetail)
        assertEquals("Est. 19 Nov", s.destinationDetail)
        assertEquals("Standard shipping", s.serviceLabel)
        assertEquals(0.2 + 0.5 * 0.6, s.progress, 0.0001) // 3 of 6 days
        assertEquals("https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id=JD0147", s.trackingUrl)

        val noCity = OrderTrackingSnapshot.from(OrderFixtures.detail(), null, now)!!
        assertEquals("Acme Studio", noCity.originLabel)
    }

    @Test fun snapshotDeliveredAndLate() {
        val base = OrderFixtures.detail()
        val delivered = withStates("delivered", "paid", "delivered", base).copy(
            delivery = base.delivery!!.copy(estimate = OrderEstimate(deliveredOn = "2026-11-17")),
        )
        val s = OrderTrackingSnapshot.from(delivered, null)!!
        assertEquals("Delivered", s.statusLabel)
        assertEquals("17 Nov", s.etaTitle)
        assertEquals("Delivered 17 Nov", s.destinationDetail)
        assertEquals(1.0, s.progress, 0.0)

        val late = base.copy(delivery = base.delivery!!.copy(estimate = base.delivery!!.estimate!!.copy(late = true)))
        val l = OrderTrackingSnapshot.from(late, null)!!
        assertTrue(l.isLate)
        assertEquals("Running late, now", l.etaCaption)
    }

    @Test fun timeProgressClamps() {
        assertEquals(0.5, OrderTrackingSnapshot.timeProgress(null, "2026-11-19"), 0.0)
        assertEquals(0.7, OrderTrackingSnapshot.timeProgress("2026-11-19", "2026-11-19"), 0.0)
        assertEquals(0.2, OrderTrackingSnapshot.timeProgress("2026-11-13", "2026-11-19", Instant.parse("2026-11-01T00:00:00Z")), 0.0)
        assertEquals(0.8, OrderTrackingSnapshot.timeProgress("2026-11-13", "2026-11-19", Instant.parse("2026-12-30T00:00:00Z")), 0.0)
    }

    // endregion

    // region Grouping

    @Test fun groupsByCheckoutNewestFirstAndFilters() {
        val a1 = OrderFixtures.summary(OrderFixtures.summaryJson(id = "a1", checkoutId = "chk_a", placedAt = "2026-11-01T10:00:00.000Z", totalMinor = 1000, merchant = "delivered", fulfilment = "delivered"))
        val b1 = OrderFixtures.summary(OrderFixtures.summaryJson(id = "b1", checkoutId = "chk_b", placedAt = "2026-11-10T10:00:00.000Z", totalMinor = 2000))
        val a2 = OrderFixtures.summary(OrderFixtures.summaryJson(id = "a2", checkoutId = "chk_a", placedAt = "2026-11-01T10:00:00.000Z", totalMinor = 500, merchant = "refunded"))
        val c1 = OrderFixtures.summary(OrderFixtures.summaryJson(id = "c1", checkoutId = null, groupReference = "YRD-OLD", placedAt = "2026-10-01T10:00:00.000Z"))
        val groups = OrderCheckoutGroup.groups(listOf(a1, b1, a2, c1))
        assertEquals(listOf("chk_b", "chk_a", "YRD-OLD"), groups.map { it.id })
        assertEquals(1500, groups[1].totalMinor)
        assertEquals(listOf("a1", "a2"), groups[1].orders.map { it.id })
        assertFalse(groups[1].isOpen)
        assertEquals(listOf("chk_b", "YRD-OLD"), OrdersListModel.filter(groups, OrdersListFilter.Open).map { it.id })
        assertEquals(listOf("chk_a"), OrdersListModel.filter(groups, OrdersListFilter.Closed).map { it.id })
        assertEquals(3, OrdersListModel.filter(groups, OrdersListFilter.All).size)
    }

    // endregion
}
