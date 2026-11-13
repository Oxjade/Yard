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
import java.time.Instant

class PlaceDetailModelTest {
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

    @Test fun loadsDetail() = runTest {
        server.enqueue(MockResponse().setBody(AroundJson.detail))
        val model = PlaceDetailModel("loc_lagos_thread_ikoyi", api, baseUrl = base)
        model.loadNow()
        assertEquals("/api/around/places/loc_lagos_thread_ikoyi", server.takeRequest().path)
        assertNull(model.loadError)
        assertTrue(!model.isLoading)
        assertEquals("12 Bourdillon Road", model.detail?.addressLine)
        assertEquals("Lagos Thread", model.detail?.summary?.brand?.name)
    }

    @Test fun notFoundIsAnAPIError404() = runTest {
        server.enqueue(MockResponse().setResponseCode(404).setBody("""{"error":{"code":"not_found","message":"Not found."}}"""))
        val model = PlaceDetailModel("loc_gone", api, baseUrl = base)
        model.loadNow()
        assertTrue((model.loadError as APIError).isNotFound)
        assertNull(model.detail)
    }

    @Test fun badBodyIsADecodingError() = runTest {
        server.enqueue(MockResponse().setBody("""{"nope":true}"""))
        val model = PlaceDetailModel("loc_x", api, baseUrl = base)
        model.loadNow()
        assertTrue(model.loadError is APIError)
        assertNull(model.detail)
    }

    @Test fun retryAfterErrorClearsIt() = runTest {
        server.enqueue(MockResponse().setResponseCode(500).setBody("""{"error":{"code":"internal","message":"Something went wrong."}}"""))
        server.enqueue(MockResponse().setBody(AroundJson.detail))
        val model = PlaceDetailModel("loc_lagos_thread_ikoyi", api, baseUrl = base)
        model.loadNow()
        assertEquals("Something went wrong.", model.loadError?.message)
        model.loadNow()
        assertNull(model.loadError)
        assertEquals(1, model.detail?.featured?.size)
    }

    @Test fun eventWhenLines() {
        val e = AroundFixtures.detail.events.single().copy(startsAt = "2026-11-21T11:00:00.000Z", endsAt = "2026-11-21T18:00:00.000Z")
        assertEquals("Sat 21 Nov" to false, aroundEventWhen(e, "Africa/Lagos", Instant.parse("2026-11-13T12:00:00Z")))
        assertEquals("On now, until Sat 21 Nov, 19:00" to true, aroundEventWhen(e, "Africa/Lagos", Instant.parse("2026-11-21T12:00:00Z")))
        assertEquals("" to false, aroundEventWhen(e.copy(endsAt = ""), "UTC", Instant.parse("2026-11-13T12:00:00Z")))
    }

    @Test fun directionsQueryUsesAddressThenArea() {
        assertEquals("12 Bourdillon Road, Ikoyi, Lagos, Nigeria", aroundDirectionsQuery(AroundFixtures.detail))
        val noAddress = AroundFixtures.detail.copy(addressLine = "", summary = AroundFixtures.popup)
        assertEquals("Shoreditch, London, United Kingdom", aroundDirectionsQuery(noAddress))
    }
}
