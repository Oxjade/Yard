package space.yardstore.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import space.yardstore.app.core.models.BrandsPage
import space.yardstore.app.core.models.Cart
import space.yardstore.app.core.models.DropDetailResponse
import space.yardstore.app.core.models.DropsPage
import space.yardstore.app.core.models.FollowCountsResponse
import space.yardstore.app.core.models.FollowsResponse
import space.yardstore.app.core.models.Money
import space.yardstore.app.core.models.ProductResponse
import space.yardstore.app.core.models.ProductsPage
import space.yardstore.app.core.models.PublicStorefront
import space.yardstore.app.core.models.Session
import space.yardstore.app.core.models.WishlistResponse
import space.yardstore.app.core.models.YardJson

class ModelDecodingTest {
    private val productJson = """
        {
          "id": "prd_1", "slug": "boxy-tee", "brandId": "brd_1", "title": "Boxy tee",
          "description": "Heavyweight.", "details": ["100% cotton"], "category": "tops", "subcategory": null,
          "tags": ["basics"], "badges": ["New"], "priceMinor": 4500, "compareAtMinor": 6000, "currency": "USD",
          "images": [{"id": "img_1", "src": "/api/media/m1", "alt": "", "width": 800, "height": 1000, "mediaId": "m1"}],
          "options": [{"name": "Size", "values": [{"value": "S"}, {"value": "M", "hex": null}]}],
          "variants": [{"id": "var_1", "sku": "BT-S", "options": {"Size": "S"}, "label": "Size S", "priceMinor": 4500, "available": 0},
                       {"id": "var_2", "sku": "BT-M", "options": {"Size": "M"}, "label": "Size M", "priceMinor": 5000, "available": 3, "inStock": true}],
          "available": 3, "processingDays": [2, 4], "dropId": null, "collectionIds": [],
          "publishedAt": "2026-11-01T10:00:00.000Z", "createdAt": "2026-10-30T10:00:00.000Z",
          "brand": {"id": "brd_1", "handle": "acme", "name": "Acme Studio", "verified": true, "city": "Lagos", "country": "NG",
                    "currency": "NGN", "foundingBadge": true, "forSale": true, "hasStorefront": true, "somethingNew": 1},
          "unknownField": {"nested": true}
        }
    """.trimIndent()

    @Test fun product() {
        val page = YardJson.decodeFromString(ProductsPage.serializer(), """{"products": [$productJson], "total": 41, "nextOffset": 24}""")
        assertEquals(41, page.total)
        assertEquals(24, page.nextOffset)
        val p = page.products.single()
        assertEquals("boxy-tee", p.slug)
        assertEquals(Money(6000, "USD"), p.compareAt)
        assertEquals("https://yardstore.space/api/media/m1", p.coverUrl)
        assertEquals(0.8, p.tileAspectRatio, 0.0001)
        assertTrue(p.isNew)
        assertFalse(p.isSoldOut)
        assertEquals(4500..5000, p.variantPriceRange)
        assertEquals("Ships in 2–4 days", p.processingText)
        assertFalse(p.variants[0].inStock) // defaulted from available
        assertEquals("Acme Studio", p.brand?.name)
        val detail = YardJson.decodeFromString(ProductResponse.serializer(), """{"product": {"id": "prd_2", "priceMinor": null, "images": null}}""")
        assertEquals("prd_2", detail.product.slug)
        assertEquals(0, detail.product.priceMinor)
        assertEquals("USD", detail.product.currency)
        assertTrue(detail.product.isSoldOut)
    }

    @Test fun brands() {
        val page = YardJson.decodeFromString(BrandsPage.serializer(), """
            {"brands": [{"id": "brd_1", "handle": "acme", "name": "Acme Studio", "city": "Lagos", "country": "NG",
              "categories": ["tops"], "story": null, "logoSrc": "/api/media/logo", "verified": true, "founding": true,
              "foundingBadge": true, "forSale": false, "listedAt": "2026-01-01T00:00:00Z"}], "total": 1, "nextOffset": null}
        """)
        val b = page.brands.single()
        assertEquals("Lagos, NG", b.locationText)
        assertEquals("AC", b.monogram)
        assertEquals("https://yardstore.space/api/media/logo", b.logoUrl)
        assertNull(b.coverUrl)
        assertFalse(b.forSale)
        assertNull(page.nextOffset)
    }

    @Test fun session() {
        val s = YardJson.decodeFromString(Session.serializer(), """
            {"shopper": {"id": "usr_1", "name": "Ada Obi", "email": "ada@example.com", "status": "active", "demo": false},
             "brand": null, "sampleData": false, "admin": {"id": "x"}}
        """)
        assertEquals("Ada", s.shopper?.firstName)
        assertEquals("AO", s.shopper?.initials)
        val out = YardJson.decodeFromString(Session.serializer(), """{"shopper": null}""")
        assertNull(out.shopper)
    }

    @Test fun cart() {
        val cart = YardJson.decodeFromString(Cart.serializer(), """
            {"id": "cart_1", "currency": "USD", "itemCount": 3, "subtotalMinor": 13500,
             "lines": [{"variantId": "var_2", "productId": "prd_1", "brandId": "brd_1", "title": "Boxy tee", "variantLabel": "Size M",
                        "imagePath": "/api/media/m1", "qty": 3, "available": 5, "unitPrice": {"amountMinor": 4500, "currency": "USD"},
                        "unitMinor": 4500, "lineMinor": 13500, "status": "ok", "brandName": "Acme Studio"},
                       {"variantId": "var_9", "qty": 1, "status": "unavailable", "unavailableReason": "sold_out"}],
             "groups": [{"brandId": "brd_1", "variantIds": ["var_2", "var_9"], "subtotalMinor": 13500,
                         "shipping": {"brandId": "brd_1", "brandName": "Acme Studio", "unavailable": false,
                                      "options": [{"service": "standard", "label": "Standard", "available": true, "priceMinor": 1500, "currency": "USD", "free": false}]}}],
             "issues": ["Only 1 of Tee (Size M) left."], "removedSample": 0, "destination": {"country": "NG", "city": "Lagos"}}
        """)
        assertEquals(3, cart.itemCount)
        assertEquals(Money(4500, "USD"), cart.lines[0].unitPrice)
        assertEquals("https://yardstore.space/api/media/m1", cart.lines[0].imageUrl)
        assertTrue(cart.lines[1].isUnavailable)
        assertNull(cart.lines[1].unitPrice)
        assertEquals(listOf("var_2", "var_9"), cart.lines(cart.groups[0]).map { it.variantId })
        assertEquals(Money(1500, "USD"), cart.groups[0].shipping?.options?.first()?.price)
        assertEquals("NG", cart.destination?.country)
        assertEquals(Money(13500, "USD"), cart.subtotal)
    }

    @Test fun drops() {
        val dropJson = """
            {"id": "drp_1", "slug": "spring", "brand": {"id": "brd_1", "handle": "acme", "name": "Acme"}, "name": "Spring",
             "description": "", "image": "med_123", "access": "draw", "status": "scheduled", "phase": "entries_open",
             "startsAt": "2026-11-20T18:00:00.000Z", "endsAt": "2026-11-21T18:00:00.000Z", "entryOpensAt": null,
             "winners": 50, "limitPerCustomer": 1, "totalUnits": 200, "productIds": ["prd_1"], "entries": 812, "sponsored": false,
             "variantIds": ["var_1"], "unitsAvailable": 150}
        """
        val page = YardJson.decodeFromString(DropsPage.serializer(), """{"items": [$dropJson], "nextCursor": "c2"}""")
        val d = page.items.single()
        assertTrue(d.isDraw)
        assertTrue(d.isUpcoming)
        assertEquals("Draw", d.accessLabel)
        assertEquals("https://yardstore.space/api/media/med_123", d.imageUrl)
        assertNotNull(d.startDate)
        assertEquals("c2", page.nextCursor)
        val detail = YardJson.decodeFromString(DropDetailResponse.serializer(), """
            {"drop": $dropJson, "me": {"reminder": true, "following": false, "earlyAccess": false,
             "entry": {"status": "entered", "rank": null, "enteredAt": "2026-11-13T10:00:00Z"}, "canBuy": false,
             "reason": "Entries are open.", "claimed": 0, "remainingAllowance": 1}}
        """)
        assertEquals("entered", detail.me?.entry?.status)
        assertTrue(detail.me?.reminder == true)
    }

    @Test fun followsAndWishlist() {
        val follows = YardJson.decodeFromString(FollowsResponse.serializer(), """
            {"items": [{"brandId": "brd_1", "followedAt": "2026-11-01T00:00:00Z", "handle": "acme", "name": "Acme", "city": null, "verified": true, "followers": 1240}]}
        """)
        assertEquals(1240, follows.items.single().followers)
        val counts = YardJson.decodeFromString(FollowCountsResponse.serializer(), """{"counts": {"brd_1": 1240, "brd_2": 3}}""")
        assertEquals(3, counts.counts["brd_2"])
        val wishlist = YardJson.decodeFromString(WishlistResponse.serializer(), """
            {"items": [{"productId": "prd_1", "brandId": "brd_1", "savedAt": "2026-11-01T00:00:00Z", "title": "Boxy tee", "slug": "boxy-tee",
                        "brandName": "Acme", "available": 2, "price": {"amount": 4500, "currency": "USD"}, "listed": true, "backInStockVariantIds": []}]}
        """)
        assertEquals("$45", wishlist.items.single().price?.formatted)
    }

    @Test fun storefront() {
        val sf = YardJson.decodeFromString(PublicStorefront.serializer(), """
            {"brand": {"id": "brd_1", "handle": "acme", "name": "Acme Studio", "city": "Lagos", "citySlug": "lagos", "country": "NG",
                       "currency": "NGN", "categories": ["tops"], "verified": true, "reviewStatus": "verified", "joinedAt": null,
                       "followersBase": 100, "timeZone": "Africa/Lagos", "foundingBadge": false, "forSale": true, "logoSrc": null},
             "storefront": {"version": 3, "publishedAt": "2026-11-01T00:00:00Z",
                            "config": {"template": "street", "accent": "acid", "typePreset": "condensed", "intro": "Cut in Lagos.",
                                       "announcement": {"text": "Spring drop Friday", "href": "/drops/spring"},
                                       "sections": [{"id": "s1", "type": "featured-products", "enabled": true, "productIds": ["prd_1"]}, {"type": "story"}],
                                       "coverMediaId": "cov_1", "mark": {"text": "AC"}, "social": {"instagram": "acme"}}},
             "collections": [{"id": "col_1", "handle": "summer", "name": "Summer", "description": "", "imageMediaId": "img_9", "productIds": ["prd_1"]}]}
        """)
        assertEquals("Lagos, NG", sf.brand.locationText)
        assertEquals("https://yardstore.space/api/media/cov_1", sf.storefront?.config?.coverUrl)
        assertEquals("/drops/spring", sf.storefront?.config?.announcement?.href)
        assertEquals(2, sf.storefront?.config?.sections?.size)
        assertTrue(sf.storefront!!.config.sections[1].id.isNotEmpty())
        assertEquals("https://yardstore.space/api/media/img_9", sf.collections.single().imageUrl)
    }
}
