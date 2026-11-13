package space.yardstore.app.features.home

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import space.yardstore.app.core.models.BrandCard
import space.yardstore.app.core.models.Drop
import space.yardstore.app.core.models.Product
import space.yardstore.app.core.models.ProductImage
import space.yardstore.app.core.models.YardJson

class HomeModelsTest {
    @Test fun decodesCategoriesLikePublicCategories() {
        val raw = """
        {"categories": [
          {"slug": "tops", "name": "Tops", "description": "Tees and shirts", "imagePath": "/site/tops.jpg",
           "subcategories": [{"slug": "tees", "name": "Tees"}], "productCount": 42, "brandCount": 7},
          {"slug": "bags", "name": "Bags", "description": null, "imagePath": null, "subcategories": [], "productCount": 0, "brandCount": 0},
          {"slug": "hats"}
        ]}
        """
        val r = YardJson.decodeFromString(HomeCategoriesResponse.serializer(), raw)
        assertEquals(3, r.categories.size)
        assertEquals(HomeCategory("tops", "Tops", 42), r.categories[0])
        assertEquals(0, r.categories[1].productCount)
        assertEquals("hats", r.categories[2].name)
        assertEquals(0, r.categories[2].productCount)
    }

    @Test fun decodesNotificationsAndInboxUnread() {
        val notes = YardJson.decodeFromString(
            HomeNotificationsResponse.serializer(),
            """{"items": [
              {"id": "ntf_1", "key": "order.shipped:1", "recipient": {"kind": "shopper", "id": "usr_1"}, "category": "orders",
               "title": "Shipped", "body": "On its way", "href": "/orders/1", "at": "2026-11-12T10:00:00.000Z", "read": false},
              {"id": "ntf_2", "key": "k2", "category": "drops", "title": "Live", "body": "", "href": null, "at": "2026-11-11T10:00:00.000Z", "read": true}
            ]}""",
        )
        assertEquals(listOf(false, true), notes.items.map { it.read })
        assertEquals(4, YardJson.decodeFromString(HomeInboxUnread.serializer(), """{"conversations": 4}""").conversations)
        assertNull(YardJson.decodeFromString(HomeInboxUnread.serializer(), "{}").conversations)
    }

    @Test fun tabIdsAndTitles() {
        assertEquals("for-you", HomeTab.ForYou.id)
        assertEquals("For you", HomeTab.ForYou.title)
        assertEquals("following", HomeTab.Following.id)
        assertEquals("Following", HomeTab.Following.title)
        val tab = HomeTab.Category(HomeCategory("tops", "Tops", 3))
        assertEquals("category-tops", tab.id)
        assertEquals("Tops", tab.title)
    }

    @Test fun feedItemIdsArePrefixedByKind() {
        assertEquals("p-1", HomeFeedItem.ProductItem(Product(id = "1")).id)
        assertEquals("b-1", HomeFeedItem.BrandItem(BrandCard(id = "1")).id)
        assertEquals("d-1", HomeFeedItem.DropItem(Drop(id = "1")).id)
    }

    @Test fun stableHashMatchesIosDjb2() {
        // djb2("abc") = 193485963; % 1_000_003 = 485384 (same arithmetic as HomeShape.swift).
        assertEquals(485384, HomeShape.stableHash("abc"))
        assertEquals(5381, HomeShape.stableHash(""))
        assertEquals(HomeShape.stableHash("prd_123"), HomeShape.stableHash("prd_123"))
        // Long strings wrap like UInt64 &* / &+ and stay non-negative.
        assertTrue(HomeShape.stableHash("x".repeat(500)) in 0 until 1_000_003)
    }

    @Test fun brandRatioIsOneOfTheFourShapes() {
        val allowed = setOf(1.15f, 1.35f, 1.5f, 1.25f)
        listOf("brd_1", "brd_2", "acme", "").forEach { assertTrue(HomeShape.brandRatio(it) in allowed) }
    }

    @Test fun shapedSizesOnlyUnsizedCovers() {
        val unsized = Product(id = "abc", images = listOf(ProductImage(id = "i1", src = "/api/media/1"), ProductImage(id = "i2", src = "/api/media/2")))
        val shaped = HomeShape.shaped(unsized)
        val expected = HomeShape.productAspects[485384 % HomeShape.productAspects.size]
        assertEquals(1000, shaped.images[0].height)
        assertEquals((expected * 1000).toInt(), shaped.images[0].width)
        assertEquals("/api/media/1", shaped.images[0].src)
        assertEquals(unsized.images[1], shaped.images[1])

        val sized = Product(id = "s", images = listOf(ProductImage(id = "i", src = "/x", width = 800, height = 1000)))
        assertSame(sized, HomeShape.shaped(sized))
        val noImages = Product(id = "n")
        assertSame(noImages, HomeShape.shaped(noImages))
    }
}
