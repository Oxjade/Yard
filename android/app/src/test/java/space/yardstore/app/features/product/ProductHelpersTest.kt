package space.yardstore.app.features.product

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import space.yardstore.app.core.models.Product
import space.yardstore.app.core.models.ProductOption
import space.yardstore.app.core.models.ProductVariant
import space.yardstore.app.core.models.YardJson
import space.yardstore.app.designsystem.YardWindow
import androidx.compose.ui.unit.dp

/** DTO decoding and pure helpers of the product feature. */
class ProductHelpersTest {
    @Test fun decodesEstimate() {
        val e = YardJson.decodeFromString(
            ProductEstimate.serializer(),
            """
            {"brand":{"id":"b","name":"Acme","originCity":"Lagos","originCountry":"NG","timeZone":"Africa/Lagos","cutoffLocal":"14:00","workdays":31},
             "handling":[1,2],"destination":{"country":"GB","city":null},
             "options":[{"methodId":"m","service":"standard","label":"Standard","available":false,"reason":"Doesn't ship to the UK","price":{"amount":1500,"currency":"GBP"},"free":false,"transit":[5,8],"providerId":"manual","guaranteed":false}],
             "unavailable":true,"reason":"Doesn't ship to United Kingdom yet.","cutoffAt":"2026-11-13T13:00:00.000Z","calendarCountries":[],"providerKind":"manual","computedAt":"2026-11-13T09:00:00.000Z"}
            """.trimIndent(),
        )
        assertEquals("14:00", e.brand?.cutoffLocal)
        assertEquals(listOf(1, 2), e.handling)
        assertTrue(e.unavailable)
        assertEquals("Doesn't ship to United Kingdom yet.", e.reason)
        assertEquals(1500, e.options.first().price?.amount)
        assertNull(e.standard) // unavailable options are not parcel options
    }

    @Test fun decodesSparseEstimate() {
        val e = YardJson.decodeFromString(ProductEstimate.serializer(), """{"options":[{"service":"express","available":true,"transit":[1,2]}],"cutoffAt":null}""")
        assertNull(e.brand)
        assertFalse(e.unavailable)
        assertEquals("express", e.standard?.service) // no standard: first parcel option
        assertEquals("express", e.express?.service)
    }

    @Test fun decodesBackInStockWatch() {
        val w = YardJson.decodeFromString(ProductBackInStockWatch.serializer(), """{"variantId":"v1","watching":true}""")
        assertEquals("v1", w.variantId)
        assertTrue(w.watching)
        val body = YardJson.encodeToString(ProductBackInStockBody.serializer(), ProductBackInStockBody("v1"))
        assertEquals("""{"variantId":"v1"}""", body)
    }

    @Test fun businessDays() {
        assertEquals("1–3 business days", ProductShippingFormat.businessDays(listOf(1, 3)))
        assertEquals("1 business day", ProductShippingFormat.businessDays(listOf(1, 1)))
        assertEquals("2 business days", ProductShippingFormat.businessDays(listOf(2, 2)))
        assertEquals("the same business day", ProductShippingFormat.businessDays(listOf(0, 0)))
        assertNull(ProductShippingFormat.businessDays(listOf(1)))
    }

    @Test fun dateRanges() {
        assertEquals("Tue 18 – Fri 21 Nov", ProductShippingFormat.range("2025-11-18", "2025-11-21"))
        assertEquals("Fri 28 Nov – Tue 2 Dec", ProductShippingFormat.range("2025-11-28", "2025-12-02"))
        assertEquals("Mon 16 Nov", ProductShippingFormat.range("2026-11-16", "2026-11-16T00:00:00Z"))
        assertNull(ProductShippingFormat.range("soon", "2026-11-16"))
    }

    @Test fun swatchColour() {
        assertEquals(0xFF111111.toInt(), argb(ProductSwatchColor.color("#111111")))
        assertEquals(0xFFAABBCC.toInt(), argb(ProductSwatchColor.color(" abc ")))
        assertNull(ProductSwatchColor.color("#12"))
        assertNull(ProductSwatchColor.color("zzzzzz"))
        assertNull(ProductSwatchColor.color(null))
    }

    private fun argb(c: androidx.compose.ui.graphics.Color?): Int? {
        if (c == null) return null
        fun ch(f: Float) = (f * 255f + 0.5f).toInt()
        return (ch(c.alpha) shl 24) or (ch(c.red) shl 16) or (ch(c.green) shl 8) or ch(c.blue)
    }

    @Test fun countryNames() {
        assertEquals("Nigeria", ProductDetailModel.countryName("ng"))
        assertEquals("South Korea", ProductDetailModel.countryName("KR"))
        assertEquals("Canada", ProductDetailModel.countryName("CA"))
    }

    @Test fun initialSelectionRules() {
        val p = Product(
            id = "p",
            options = listOf(
                ProductOption("Colour", listOf(ProductOption.Value("Red"), ProductOption.Value("Blue"))),
                ProductOption("SIZE", listOf(ProductOption.Value("One size"))),
            ),
            variants = listOf(
                ProductVariant("a", options = mapOf("Colour" to "Red", "SIZE" to "One size"), available = 0),
                ProductVariant("b", options = mapOf("Colour" to "Blue", "SIZE" to "One size"), available = 2),
            ),
            available = 2,
        )
        // First colour in stock (Blue), single size pre-chosen.
        assertEquals(mapOf("Colour" to "Blue", "SIZE" to "One size"), ProductDetailModel.initialSelection(p))
        assertTrue(ProductDetailModel.isSizeName("size"))
        assertFalse(ProductDetailModel.isSizeName("Sizes"))
    }

    @Test fun noOptionsUsesFirstVariant() {
        val p = Product(id = "p", variants = listOf(ProductVariant("only", available = 5)), available = 5)
        val model = ProductDetailModel(p)
        assertEquals("only", model.variant?.id)
        assertEquals("In stock" to ProductDetailModel.StockTone.Ok, model.stockLine())
    }

    @Test fun tabletGalleryTakesAboutSixtyPercent() {
        // Tablet rule 4: gallery ≈ 55–60% on Medium+.
        assertEquals(0.55f, productGalleryWeight(YardWindow(width = 700.dp, height = 1000.dp)))
        assertEquals(0.58f, productGalleryWeight(YardWindow(width = 1280.dp, height = 800.dp)))
    }
}
