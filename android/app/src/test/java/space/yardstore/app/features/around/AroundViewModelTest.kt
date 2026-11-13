package space.yardstore.app.features.around

import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.core.networking.PersistentCookieJar

class AroundViewModelTest {
    private lateinit var server: MockWebServer
    private lateinit var api: APIClient
    private lateinit var base: String

    @Before fun setUp() {
        server = MockWebServer()
        server.start()
        api = APIClient(APIClient.buildHttpClient(PersistentCookieJar(null)))
        base = server.url("/").toString().trimEnd('/')
    }

    @After fun tearDown() {
        server.shutdown()
    }

    private fun json(body: String, code: Int = 200) = MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

    @Test fun loadsWorldListThenLogos() = runTest {
        server.enqueue(json(AroundJson.places))
        server.enqueue(json(AroundJson.brandsPage))
        val model = AroundViewModel(api, base)
        assertTrue(model.phase is AroundViewModel.Phase.Idle)
        model.loadNow()
        assertTrue(model.hasLoaded)
        assertNull(model.error)
        assertEquals(2, model.places.size)

        val placesReq = server.takeRequest()
        assertEquals("/api/around/places?scope=world", placesReq.path)
        assertEquals("1", placesReq.getHeader("X-Yard-Client"))
        assertEquals("/api/catalog/brands?limit=60&offset=0", server.takeRequest().path)

        val store = model.place("loc_lagos_thread_ikoyi")!!
        assertTrue(model.logoUrl(store)!!.endsWith("/api/media/logo_lt"))
        assertNull(model.logoUrl(model.place("loc_acme_shoreditch")!!)) // no logo → monogram
        assertEquals(setOf("brd_lagos_thread"), model.logos.keys)    // only brands on the map
    }

    @Test fun failureWithNothingLoadedShowsError() = runTest {
        server.enqueue(json("""{"error":{"code":"rate_limited","message":"Slow down a little."}}""", 429))
        val model = AroundViewModel(api, base)
        model.loadNow()
        val e = model.error as APIError
        assertEquals("Slow down a little.", e.message)
        assertTrue(model.places.isEmpty())
        assertTrue(!model.isLoading)
    }

    @Test fun refreshFailureKeepsThePlaces() = runTest {
        server.enqueue(json(AroundJson.places))
        server.enqueue(json(AroundJson.brandsPage))
        val model = AroundViewModel(api, base)
        model.loadNow()
        server.enqueue(json("""{"error":{"code":"internal","message":"Something went wrong."}}""", 500))
        model.loadNow()
        assertTrue(model.hasLoaded)
        assertNull(model.error)
        assertEquals(2, model.places.size)
    }

    @Test fun logoPagingStopsAfterThreePages() = runTest {
        server.enqueue(json(AroundJson.places))
        val page = """{"brands":[{"id":"brd_nobody","handle":"n","name":"N","logoSrc":"/x"}],"total":500,"nextOffset":60}"""
        repeat(4) { server.enqueue(json(page)) }
        val model = AroundViewModel(api, base)
        model.loadNow()
        assertEquals(4, server.requestCount) // places + 3 brand pages
        assertTrue(model.logos.isEmpty())
    }

    @Test fun emptyWorldIsLoadedAndEmpty() = runTest {
        server.enqueue(json("""{"places":[],"scope":"world"}"""))
        val model = AroundViewModel(api, base)
        model.loadNow()
        assertTrue(model.hasLoaded)
        assertTrue(model.places.isEmpty())
        assertEquals(1, server.requestCount) // no logo lookups for an empty map
    }

    @Test fun visiblePlacesFilterAndSort() {
        val model = AroundViewModel(AroundFixtures.places)
        val lagosRegion = AroundRegion(AroundCoordinate(6.45, 3.43), 1.0, 1.0)
        assertEquals(listOf("loc_preview_store"), model.visiblePlaces(lagosRegion, null).map { it.id })
        // No region, origin in London: nearest first.
        val fromLondon = model.visiblePlaces(null, AroundCoordinate(51.5, -0.1)).map { it.id }
        assertEquals(listOf("loc_preview_popup", "loc_preview_store"), fromLondon)
        // No region, no origin: by brand name.
        assertEquals(listOf("Acme Studio", "Lagos Thread"), model.visiblePlaces(null, null).map { it.brand.name })
        // World region, centre in Lagos: nearest to the centre first.
        val world = AroundRegion(AroundCoordinate(6.0, 3.0), 170.0, 350.0)
        assertEquals("loc_preview_store", model.visiblePlaces(world, null).first().id)
    }

    @Test fun regionContainsWrapsTheAntimeridian() {
        val r = AroundRegion(AroundCoordinate(0.0, 179.0), 10.0, 10.0)
        assertTrue(AroundViewModel.contains(r, AroundCoordinate(0.0, -178.0)))
        assertTrue(!AroundViewModel.contains(r, AroundCoordinate(0.0, 170.0)))
    }

    @Test fun searchMatchesAreaThenBrandIgnoringAccents() {
        val model = AroundViewModel(
            AroundFixtures.places + AroundFixtures.store.copy(id = "loc_mx", city = "Ciudad de México", citySlug = "ciudad-de-mexico", country = "MX", neighbourhood = "Roma Norte"),
        )
        assertEquals(listOf("loc_mx"), model.matches("mexico").map { it.id })
        assertEquals(listOf("loc_mx"), model.matches("ciudad de mexico").map { it.id })
        assertEquals(listOf("loc_mx"), model.matches("  ROMA  ").map { it.id })
        assertEquals(listOf("loc_preview_popup"), model.matches("United Kingdom").map { it.id })
        assertEquals(listOf("loc_preview_popup"), model.matches("acme").map { it.id })
        assertTrue(model.matches("").isEmpty())
        assertTrue(model.matches("Seoul").isEmpty())
        assertEquals("cafe", AroundViewModel.fold(" Café "))
    }

    @Test fun regionFittingPadsAndClamps() {
        assertNull(AroundViewModel.regionFitting(emptyList()))
        val single = AroundViewModel.regionFitting(listOf(AroundCoordinate(6.0, 3.0)))!!
        assertEquals(0.04, single.latitudeDelta, 1e-9)
        val both = AroundViewModel.regionFitting(AroundFixtures.places.map { it.coordinate })!!
        assertEquals((6.4541 + 51.5246) / 2, both.center.latitude, 1e-9)
        assertEquals((51.5246 - 6.4541) * 1.6, both.latitudeDelta, 1e-9)
        val wide = AroundViewModel.regionFitting(listOf(AroundCoordinate(-80.0, -179.0), AroundCoordinate(80.0, 179.0)))!!
        assertEquals(170.0, wide.latitudeDelta, 1e-9)
        assertEquals(350.0, wide.longitudeDelta, 1e-9)
    }

    @Test fun listSubtitle() {
        assertEquals("Loading places…", aroundListSubtitle(0, 0, isLoading = true, failed = false, isLocated = false))
        assertEquals("Stores, showrooms, pop-ups and exhibitions", aroundListSubtitle(0, 0, isLoading = false, failed = true, isLocated = false))
        assertEquals("Stores, showrooms, pop-ups and exhibitions", aroundListSubtitle(0, 0, isLoading = false, failed = false, isLocated = false))
        assertEquals("1 place in view", aroundListSubtitle(1, 5, isLoading = false, failed = false, isLocated = true))
        assertEquals("3 places in view · nearest first", aroundListSubtitle(3, 5, isLoading = false, failed = false, isLocated = true))
        assertEquals("3 places in view", aroundListSubtitle(3, 5, isLoading = false, failed = false, isLocated = false))
    }
}
