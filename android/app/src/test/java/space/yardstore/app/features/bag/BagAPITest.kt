package space.yardstore.app.features.bag

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import space.yardstore.app.core.models.Cart
import space.yardstore.app.core.models.YardJson

class BagAPITest {
    @Test fun decodesCartQuotesWithEstimates() {
        val env = YardJson.decodeFromString(BagQuoteEnvelope.serializer(), BagFixtures.CART_NG)
        assertEquals(2, env.groups.size)
        val q = env.groups[0].shipping!!
        assertEquals("Acme Studio", q.brandName)
        assertEquals(3, q.options.size)
        assertEquals("Est. arrival 18–20 Nov", q.options[0].arrivalText)
        assertEquals("Est. ready 14 Nov", q.options[2].arrivalText)
        assertTrue(env.groups[1].shipping!!.unavailable)
        // The same body still decodes as the shared Cart.
        val cart = YardJson.decodeFromString(Cart.serializer(), BagFixtures.CART_NG)
        assertEquals(3, cart.itemCount)
        assertEquals(listOf("var_tee_m"), cart.lines(cart.groups[0]).map { it.variantId })
    }

    @Test fun optionForFallsBackToStandardThenNonPickup() {
        val q = YardJson.decodeFromString(BagQuoteEnvelope.serializer(), BagFixtures.CART_NG).groups[0].shipping!!
        assertEquals("express", q.option("express")?.service)
        assertEquals("standard", q.option(null)?.service)
        assertEquals("standard", q.option("overnight")?.service)
        val noStandard = BagGroupQuote(options = listOf(
            BagQuoteOption(service = "pickup", available = true),
            BagQuoteOption(service = "express", available = true),
            BagQuoteOption(service = "standard", available = false),
        ))
        assertEquals("express", noStandard.option(null)?.service)
        assertNull(BagGroupQuote(options = listOf(BagQuoteOption(service = "pickup", available = true))).option(null))
        assertEquals("Ready once packed", BagQuoteOption(service = "pickup").arrivalText)
        assertNull(BagQuoteOption(service = "standard").arrivalText)
    }

    @Test fun decodesOptionsAndCheckout() {
        val o = YardJson.decodeFromString(BagCheckoutOptions.serializer(), """{"mode":"test","provider":"bachs","currencies":["NGN","GHS"]}""")
        assertEquals("bachs", o.provider)
        assertEquals(listOf("NGN", "GHS"), o.currencies)
        val defaults = YardJson.decodeFromString(BagCheckoutOptions.serializer(), "{}")
        assertEquals("live", defaults.mode)
        assertEquals(listOf("NGN"), defaults.currencies)

        val c = YardJson.decodeFromString(BagCheckout.serializer(), BagFixtures.checkout("pending_payment", "https://checkout.paystack.com/abc123"))
        assertEquals("chk_01", c.id)
        assertTrue(c.isPending)
        assertFalse(c.isSettled)
        assertEquals("https://checkout.paystack.com/abc123", c.paymentUrl)
        assertEquals(2_430_000, c.totalMinor)
        assertEquals(listOf("ord_a", "ord_b"), c.orderIds)

        val review = YardJson.decodeFromString(BagCheckout.serializer(), BagFixtures.checkout("review", null))
        assertTrue(review.isSettled)
        assertNull(review.paymentUrl)
        val abandoned = YardJson.decodeFromString(BagCheckout.serializer(), BagFixtures.checkout("pending_payment", null, providerStatus = "abandoned"))
        assertEquals("abandoned", abandoned.payment?.providerStatus)
    }

    @Test fun startBodyLeavesOutNullOptionals() {
        val body = BagStartCheckoutBody(
            idempotencyKey = "key-12345678",
            currency = "NGN",
            shipTo = BagStartCheckoutBody.ShipTo(name = "Ada Obi", line1 = "12 Allen Ave", city = "Ikeja, Lagos", country = "NG", phone = "+234 8031234567"),
            shipping = listOf(BagStartCheckoutBody.Choice("brd_1", "standard")),
        )
        val json = YardJson.encodeToString(BagStartCheckoutBody.serializer(), body)
        assertFalse(json.contains("postalCode"))
        assertFalse(json.contains("expectedTotalMinor"))
        assertFalse(json.contains("paymentMethod"))
        assertTrue(json.contains("\"shipping\":[{\"brandId\":\"brd_1\",\"service\":\"standard\"}]"))
    }
}
