package space.yardstore.app.features.auth

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import space.yardstore.app.core.models.BrandCard
import space.yardstore.app.core.models.YardJson
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.PersistentCookieJar

@OptIn(ExperimentalCoroutinesApi::class)
class WelcomeModelTest {
    private lateinit var server: MockWebServer
    private lateinit var api: APIClient

    @Before fun setUp() {
        Dispatchers.setMain(Dispatchers.Unconfined)
        server = MockWebServer()
        server.start()
        api = APIClient(APIClient.buildHttpClient(PersistentCookieJar(null)))
    }

    @After fun tearDown() {
        server.shutdown()
        Dispatchers.resetMain()
    }

    private fun model() = WelcomeModel(api = api, base = server.url("/").toString())
    private fun json(body: String, code: Int = 200) = MockResponse().setResponseCode(code).setBody(body)

    private fun brand(id: String) = """{"id":"$id","handle":"h-$id","name":"Brand $id","city":"Lagos","country":"NG","categories":["tops"],"story":null,"logoSrc":"/api/media/m_$id","coverSrc":null,"verified":true,"founding":false,"foundingBadge":false,"forSale":true,"listedAt":"2026-10-01T10:00:00.000Z"}"""
    private fun page(vararg ids: String) = """{"brands":[${ids.joinToString(",") { brand(it) }}],"total":${ids.size},"nextOffset":null}"""

    @Test fun decodesCategories() {
        val r = YardJson.decodeFromString(WelcomeCategoriesResponse.serializer(), """
            {"categories":[{"slug":"tops","name":"Tops","description":"Tees and shirts","imagePath":"/site/categories/tops.jpg","subcategories":[{"slug":"tees","name":"Tees"}],"productCount":120,"brandCount":14},
                           {"slug":"bags","imagePath":null,"productCount":0,"brandCount":0}]}
        """.trimIndent())
        assertEquals(2, r.categories.size)
        assertEquals("Tops", r.categories[0].title)
        assertEquals("https://yardstore.space/site/categories/tops.jpg", r.categories[0].imageUrl)
        assertEquals("bags", r.categories[1].title)
        assertNull(r.categories[1].imageUrl)
    }

    @Test fun loadsCategories() {
        server.enqueue(json("""{"categories":[{"slug":"tops","name":"Tops"},{"slug":"outerwear","name":"Outerwear"}]}"""))
        val m = model()
        m.loadCategories()
        waitUntil { m.categoriesLoaded }
        assertEquals(listOf("tops", "outerwear"), m.categories.map { it.slug })
        assertNull(m.categoriesError)
        assertEquals("/api/catalog/categories", server.takeRequest().path)
    }

    @Test fun categoriesErrorThenRetry() {
        server.enqueue(json("""{"error":{"code":"internal","message":"Yard is having trouble right now."}}""", 500))
        val m = model()
        m.loadCategories()
        waitUntil { m.categoriesError != null }
        assertEquals("Yard is having trouble right now.", m.categoriesError!!.message)
        assertTrue(m.categories.isEmpty())
        server.enqueue(json("""{"categories":[]}"""))
        m.loadCategories()
        waitUntil { m.categoriesLoaded }
        assertNull(m.categoriesError)
        assertTrue(m.categories.isEmpty())
    }

    @Test fun suggestionsPickedCategoriesFirstThenFillDeduplicated() {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val u = request.requestUrl!!
                return when (u.queryParameter("category")) {
                    "tops" -> json(page("a", "b"))
                    "bags" -> json(page("b", "c"))
                    null -> json(page("c", "d", "e", "f", "g", "h"))
                    else -> json(page())
                }
            }
        }
        val m = model()
        m.loadSuggestions(listOf("tops", "bags", "shoes", "hats"))
        waitUntil { m.suggestions != null }
        assertEquals(listOf("a", "b", "c", "d", "e", "f"), m.suggestions!!.map { it.id })
        val paths = (0 until server.requestCount).map { server.takeRequest().path }
        assertEquals(
            listOf(
                "/api/catalog/brands?category=tops&sort=new&limit=6",
                "/api/catalog/brands?category=bags&sort=new&limit=6",
                "/api/catalog/brands?category=shoes&sort=new&limit=6",
                "/api/catalog/brands?sort=new&limit=12",
            ),
            paths,
        )
    }

    @Test fun suggestionsFailureKeepsWhatLoaded() {
        server.enqueue(json(page("a")))
        server.enqueue(MockResponse().setResponseCode(500))
        val m = model()
        m.loadSuggestions(listOf("tops"))
        waitUntil { m.suggestions != null }
        assertEquals(listOf("a"), m.suggestions!!.map { it.id })
    }

    @Test fun suggestionsEmpty() {
        server.enqueue(json(page()))
        val m = model()
        m.loadSuggestions(emptyList())
        waitUntil { m.suggestions != null }
        assertTrue(m.suggestions!!.isEmpty())
    }

    @Test fun addUpToSixStopsAtSix() {
        val out = mutableListOf(BrandCard("a"))
        WelcomeModel.addUpToSix(out, listOf("a", "b", "c", "d", "e", "f", "g").map { BrandCard(it) })
        assertEquals(listOf("a", "b", "c", "d", "e", "f"), out.map { it.id })
    }

    @Test fun looksAreTheWebsiteList() {
        assertEquals(listOf("minimalist", "vintage", "avant-garde", "streetwear", "contemporary", "luxury", "experimental"), WelcomeLook.all.map { it.slug })
    }

    @Test fun copyHelpers() {
        assertEquals("Not following anyone yet. You can always follow brands later.", WelcomeCopy.followingText(0))
        assertEquals("Following 1 brand.", WelcomeCopy.followingText(1))
        assertEquals("Following 3 brands.", WelcomeCopy.followingText(3))
        assertEquals("Continue", WelcomeCopy.continueTitle(0))
        assertEquals("Continue with 1 pick", WelcomeCopy.continueTitle(1))
        assertEquals("Continue with 4 picks", WelcomeCopy.continueTitle(4))
        assertEquals("You're set. Discover shows a bit of everything for now.", WelcomeCopy.finishMessage(0, 0))
        assertEquals("You're set. Discover now leads with what you picked. Following 2 new brands.", WelcomeCopy.finishMessage(3, 2))
    }
}
