package space.yardstore.app.features.search

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import space.yardstore.app.core.models.Money
import space.yardstore.app.core.models.YardJson
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import java.util.Locale

class SearchModelsTest {

    @Test fun decodesFullSearchResponse() {
        val r = YardJson.decodeFromString(SearchResponse.serializer(), SearchFixtures.searchPage1)
        assertEquals(31, r.total)
        assertEquals("2", r.nextCursor)
        assertFalse(r.capped)
        assertEquals(2, r.items.size)
        val first = r.items[0]
        assertEquals("prd_b", first.productId)
        assertEquals("prd_b", first.id)
        assertEquals("Acme Studio", first.brandName)
        assertEquals("washed-hoodie", first.slug)
        assertEquals("/api/media/med_1", first.image)
        assertEquals(Money(13350000, "NGN"), first.display)
        assertEquals(Money(8900, "USD"), first.price)
        assertEquals(Money(13350000, "NGN"), first.shownPrice)
        assertEquals(1, r.brands.size)
        assertEquals("Lagos, NG", r.brands[0].locationText)
        assertEquals(listOf("tops", "outerwear"), r.facets!!.categories.map { it.value })
        assertEquals("Tops", r.facets!!.categories[0].label)
        assertEquals(12, r.facets!!.categories[0].count)
        assertEquals(20, r.facets!!.inStockCount)
    }

    @Test fun decodesSparseSearchResponse() {
        val r = YardJson.decodeFromString(SearchResponse.serializer(), """{"items":[{"productId":"p1","title":"Tee","display":null}],"total":1}""")
        assertEquals(1, r.items.size)
        assertNull(r.items[0].shownPrice)
        assertNull(r.nextCursor)
        assertFalse(r.capped)
        assertTrue(r.brands.isEmpty())
        assertNull(r.facets)
    }

    @Test fun shownPriceFallsBackToBrandPrice() {
        val item = SearchItem(productId = "p", price = Money(4500, "USD"))
        assertEquals(Money(4500, "USD"), item.shownPrice)
    }

    @Test fun decodesCategories() {
        val r = YardJson.decodeFromString(SearchCategoriesResponse.serializer(), SearchFixtures.categories)
        assertEquals(4, r.categories.size)
        assertEquals("hoodies", r.categories[0].slug)
        assertEquals("Hoodies", r.categories[0].name)
        assertEquals(12, r.categories[0].productCount)
        assertEquals("hoodies", r.categories[0].id)
    }

    @Test fun brandLocationText() {
        assertEquals("Lagos, NG", SearchBrandHit("b", city = "Lagos", country = "NG").locationText)
        assertEquals("NG", SearchBrandHit("b", city = "", country = "NG").locationText)
        assertNull(SearchBrandHit("b").locationText)
    }

    @Test fun sortApiValuesMatchTheRoute() {
        // src/server/follows/contracts.ts searchQuery.sort
        assertEquals(listOf("relevance", "trending", "newest", "price_asc", "price_desc"), SearchSort.entries.map { it.apiValue })
        assertEquals(listOf("Best match", "Trending", "Newest", "Price low–high", "Price high–low"), SearchSort.entries.map { it.title })
    }

    @Test fun recentsMoveToFrontDedupeAndCap() {
        val start = listOf("hoodie", "Lagos", "cargo")
        assertEquals(listOf("lagos", "hoodie", "cargo"), SearchRecents.recorded(start, "  lagos "))
        assertEquals(start, SearchRecents.recorded(start, "   "))
        val full = (1..8).map { "t$it" }
        val next = SearchRecents.recorded(full, "new")
        assertEquals(SearchRecents.LIMIT, next.size)
        assertEquals("new", next.first())
        assertEquals("t7", next.last())
    }

    @Test fun recentsWithoutPreferencesAreEmpty() {
        // Unit tests have no SharedPreferences (Config.init isn't called): nothing is stored, nothing crashes.
        assertTrue(SearchRecents.load().isEmpty())
        assertEquals(listOf("hoodie"), SearchRecents.record("hoodie"))
        SearchRecents.clear()
    }

    @Test fun categoryOptionsKeepSelectedVisible() {
        val facets = listOf(SearchCategoryFacet("tops", "Tops", 8))
        assertEquals(facets, searchCategoryOptions(facets, null))
        assertEquals(facets, searchCategoryOptions(facets, "tops"))
        val withSelected = searchCategoryOptions(facets, "outerwear")
        assertEquals(SearchCategoryFacet("outerwear", "Outerwear", 0), withSelected.first())
        assertEquals(2, withSelected.size)
    }

    @Test fun categoryOptionLabelCapitalizesLikeSwift() {
        assertEquals("T-Shirts", searchCapitalized("t-shirts"))
        assertEquals("Outer Wear", searchCapitalized("OUTER wear"))
        assertEquals("Knit_Tops", searchCapitalized("knit_tops"))
        assertEquals("", searchCapitalized(""))
        assertEquals("T-Shirts", searchCategoryOptions(emptyList(), "t-shirts").single().label)
    }

    @Test fun sideInsetCentersOnlyOnWideWindows() {
        // Compact: contentMaxWidth unspecified → no inset.
        assertEquals(0.dp, searchSideInset(400.dp, Dp.Unspecified))
        // Medium 720dp cap on an 800dp-wide area → 40dp each side.
        assertEquals(40.dp, searchSideInset(800.dp, 720.dp))
        // Expanded 960dp cap on 1200dp → 120dp each side.
        assertEquals(120.dp, searchSideInset(1200.dp, 960.dp))
        // Narrower than the cap (e.g. a rail eats the width) → never negative.
        assertEquals(0.dp, searchSideInset(700.dp, 720.dp))
    }

    @Test fun countText() {
        val saved = Locale.getDefault()
        Locale.setDefault(Locale.US)
        try {
            assertEquals("Searching the marketplace…", searchResultsCountText(SearchResultsModel.Phase.Loading, 0))
            assertEquals("Results couldn't be loaded", searchResultsCountText(SearchResultsModel.Phase.Failed("x"), 0))
            assertEquals("1 piece", searchResultsCountText(SearchResultsModel.Phase.Loaded, 1))
            assertEquals("0 pieces", searchResultsCountText(SearchResultsModel.Phase.Loaded, 0))
            assertEquals("1,234 pieces", searchResultsCountText(SearchResultsModel.Phase.Loaded, 1234))
        } finally {
            Locale.setDefault(saved)
        }
    }
}

/** Realistic JSON shaped like the website's route responses. */
object SearchFixtures {
    /** GET /api/search?q=hoodie&currency=NGN&limit=24&sort=relevance (src/server/search/index.ts `searchCatalog`). */
    val searchPage1 = """
    {
      "items": [
        {"productId":"prd_b","brandId":"brd_1","brandName":"Acme Studio","slug":"washed-hoodie","title":"Washed hoodie",
         "image":"/api/media/med_1","available":4,"category":"tops","rank":0.42,
         "price":{"amount":8900,"currency":"USD"},"display":{"amount":13350000,"currency":"NGN"}},
        {"productId":"prd_a","brandId":"brd_1","brandName":"Acme Studio","slug":"zip-hoodie","title":"Zip hoodie",
         "image":null,"available":0,"price":{"amount":9500,"currency":"USD"},"display":{"amount":14250000,"currency":"NGN"}}
      ],
      "total": 31,
      "nextCursor": "2",
      "capped": false,
      "brands": [{"brandId":"brd_2","handle":"hoodclub","name":"Hood Club","city":"Lagos","country":"NG"}],
      "facets": {
        "categories": [{"value":"tops","label":"Tops","count":12},{"value":"outerwear","label":"Outerwear","count":3}],
        "brands": [{"value":"brd_1","handle":"acme","label":"Acme Studio","count":9}],
        "brandsNextCursor": null,
        "selectedBrands": [],
        "price": {"currency":"NGN","buckets":[]},
        "sizes": [{"value":"M","count":4}],
        "countries": [{"value":"NG","count":9}],
        "inStockCount": 20
      }
    }
    """.trimIndent()

    /** The second page (no brands: those come on the first page only). */
    val searchPage2 = """
    {"items":[
       {"productId":"prd_a","title":"Zip hoodie","slug":"zip-hoodie","price":{"amount":9500,"currency":"USD"}},
       {"productId":"prd_c","title":"Crop hoodie","slug":"crop-hoodie","price":{"amount":7000,"currency":"USD"}}],
     "total":31,"nextCursor":null,"capped":true,"brands":[],
     "facets":{"categories":[],"inStockCount":20}}
    """.trimIndent()

    val searchEmpty = """{"items":[],"total":0,"nextCursor":null,"capped":false,"brands":[],"facets":{"categories":[],"inStockCount":0}}"""

    /** GET /api/catalog/products?ids=… (order differs from the search; prd_gone is missing). */
    val productsAB = """
    {"products":[
       {"id":"prd_a","slug":"zip-hoodie","brandId":"brd_1","title":"Zip hoodie","priceMinor":9500,"currency":"USD","images":[],"variants":[],"available":0},
       {"id":"prd_b","slug":"washed-hoodie","brandId":"brd_1","title":"Washed hoodie","priceMinor":8900,"currency":"USD","images":[],"variants":[],"available":4}],
     "total":2,"nextOffset":null}
    """.trimIndent()

    val productsAC = """
    {"products":[
       {"id":"prd_c","slug":"crop-hoodie","title":"Crop hoodie","priceMinor":7000,"currency":"USD"},
       {"id":"prd_a","slug":"zip-hoodie","title":"Zip hoodie","priceMinor":9500,"currency":"USD"}],
     "total":2,"nextOffset":null}
    """.trimIndent()

    /** GET /api/catalog/categories (`publicCategories`). */
    val categories = """
    {"categories":[
      {"slug":"hoodies","name":"Hoodies","description":"Heavyweight fleece","imagePath":null,"subcategories":[],"productCount":12,"brandCount":4},
      {"slug":"tops","name":"Tops","description":"","imagePath":"/media/tops.jpg","subcategories":["tees"],"productCount":30,"brandCount":9},
      {"slug":"bags","name":"Bags","description":"","imagePath":null,"subcategories":[],"productCount":0,"brandCount":0},
      {"slug":"hoodie-dresses","name":"Hoodie dresses","description":"","imagePath":null,"subcategories":[],"productCount":2,"brandCount":1}
    ]}
    """.trimIndent()

    /** GET /api/search?q=hood&currency=USD&limit=6 (type-ahead). */
    val live = """
    {"items":[{"productId":"prd_b","brandName":"Acme Studio","slug":"washed-hoodie","title":"Washed hoodie","display":{"amount":8900,"currency":"USD"}}],
     "total":14,"nextCursor":"1","capped":false,
     "brands":[{"brandId":"brd_2","handle":"hoodclub","name":"Hood Club","city":"Lagos","country":"NG"}],
     "facets":{"categories":[],"inStockCount":10}}
    """.trimIndent()
}
