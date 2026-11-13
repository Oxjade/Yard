package space.yardstore.app.features.shop

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import space.yardstore.app.core.models.Product
import space.yardstore.app.core.models.ProductsPage
import space.yardstore.app.core.models.YardJson

class ShopModelsTest {

    @Test fun decodesCategories() {
        val r = YardJson.decodeFromString<ShopCategoriesResponse>(ShopJson.categories)
        assertEquals(3, r.categories.size)
        val fashion = r.categories[0]
        assertEquals("fashion", fashion.id)
        assertEquals(listOf("Outerwear", "Shirts"), fashion.subcategories)
        assertEquals(42, fashion.productCount)
        assertTrue(fashion.imageUrl!!.endsWith("/media/categories/fashion.jpg"))
        // null description → default ""
        assertEquals("", r.categories[1].description)
        assertNull(r.categories[1].imageUrl)
    }

    @Test fun categoryNameFallsBackToCapitalisedSlug() {
        val c = YardJson.decodeFromString<ShopCategory>("""{"slug": "t-shirts"}""")
        assertEquals("T-Shirts", c.name)
        assertEquals(0, c.productCount)
        assertEquals("New In", shopTitleCase("new in"))
    }

    @Test fun categoryCountText() {
        assertEquals("Coming soon", ShopCategory("a", productCount = 0, brandCount = 0).countText)
        assertEquals("1 piece from 1 brand", ShopCategory("a", productCount = 1, brandCount = 1).countText)
        assertEquals("42 pieces from 9 brands", ShopCategory("a", productCount = 42, brandCount = 9).countText)
        assertEquals("3 pieces", ShopCategory("a", productCount = 3, brandCount = 0).countText)
    }

    @Test fun piecesText() {
        assertEquals("1 piece", ShopText.pieces(1))
        assertEquals("0 pieces", ShopText.pieces(0))
        assertEquals("24 pieces", ShopText.pieces(24))
    }

    @Test fun shopSortWireValuesAndTitles() {
        assertEquals(listOf("new", "price_asc", "price_desc"), ShopSort.entries.map { it.rawValue })
        assertEquals(listOf("Newest", "Price low–high", "Price high–low"), ShopSort.entries.map { it.title })
    }

    @Test fun collectionSortOrders() {
        val a = Product(id = "a", priceMinor = 3000, publishedAt = "2026-10-01T10:00:00Z")
        val b = Product(id = "b", priceMinor = 1000, publishedAt = null, createdAt = "2026-11-01T10:00:00.000Z")
        val c = Product(id = "c", priceMinor = 2000, publishedAt = "2026-09-01T10:00:00Z")
        val featured = listOf(a, b, c)
        assertEquals(listOf("a", "b", "c"), ShopCollectionSort.Featured.apply(featured).map { it.id })
        assertEquals(listOf("b", "a", "c"), ShopCollectionSort.Newest.apply(featured).map { it.id })
        assertEquals(listOf("b", "c", "a"), ShopCollectionSort.PriceAsc.apply(featured).map { it.id })
        assertEquals(listOf("a", "c", "b"), ShopCollectionSort.PriceDesc.apply(featured).map { it.id })
        assertEquals(
            listOf("Featured", "Newest", "Price, low to high", "Price, high to low"),
            ShopCollectionSort.entries.map { it.title },
        )
    }

    @Test fun decodesCollectionResponse() {
        val r = YardJson.decodeFromString<ShopCollectionResponse>(ShopJson.collection(listOf("p1", "p2")))
        assertEquals("winter-uniform", r.collection.handle)
        assertEquals(listOf("p1", "p2"), r.collection.productIds)
        assertTrue(r.collection.imageUrl!!.contains("med_cover"))
        assertEquals("acme", r.brand.handle)
        assertEquals("Acme Studio", r.brand.name)
        val noHandle = YardJson.decodeFromString<ShopCollectionResponse.Brand>("""{"id": "brd_x"}""")
        assertEquals("brd_x", noHandle.handle)
    }

    @Test fun decodesProductsPage() {
        val page = YardJson.decodeFromString<ProductsPage>(ShopJson.page(listOf("p1", "p2"), total = 30, nextOffset = 24))
        assertEquals(2, page.products.size)
        assertEquals(24, page.nextOffset)
        assertEquals("acme", page.products[0].brand?.handle)
    }

    @Test fun mosaicRowsAlternateWideAndPairs() {
        val rows = CategoriesLayout.rows(5)
        assertEquals(
            listOf(
                CategoriesLayout.Kind.Wide(0),
                CategoriesLayout.Kind.Pair(1, 2),
                CategoriesLayout.Kind.Wide(3),
                CategoriesLayout.Kind.Pair(4, null),
            ),
            rows.map { it.kind },
        )
        assertEquals(listOf(0, 1, 3, 4), rows.map { it.id })
        assertTrue(CategoriesLayout.rows(0).isEmpty())
        assertEquals(1, CategoriesLayout.rows(1).size)
    }
}
