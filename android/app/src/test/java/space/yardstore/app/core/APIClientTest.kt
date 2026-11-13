package space.yardstore.app.core

import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import space.yardstore.app.core.models.FollowBody
import space.yardstore.app.core.models.FollowResult
import space.yardstore.app.core.models.ProductsPage
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.core.networking.EmptyResponse
import space.yardstore.app.core.networking.HTTPMethod
import space.yardstore.app.core.networking.PersistentCookieJar

class APIClientTest {
    private lateinit var server: MockWebServer
    private lateinit var api: APIClient

    @Before fun setUp() {
        server = MockWebServer()
        server.start()
        api = APIClient(APIClient.buildHttpClient(PersistentCookieJar(null)))
    }

    @After fun tearDown() {
        server.shutdown()
    }

    private fun url(path: String) = server.url(path).toString()

    @Test fun getSendsClientHeaderAndEncodesQuery() = runTest {
        server.enqueue(MockResponse().setBody("""{"products": [], "total": 0}"""))
        val page: ProductsPage = api.get(url("/api/catalog/products"), listOf("q" to "a+b c", "skip" to null, "ids" to "1", "ids" to "2"))
        assertEquals(0, page.total)
        assertNull(page.nextOffset)
        val req = server.takeRequest()
        assertEquals("GET", req.method)
        assertEquals("1", req.getHeader("X-Yard-Client"))
        assertNull(req.getHeader("Origin"))
        assertEquals("/api/catalog/products?q=a%2Bb%20c&ids=1&ids=2", req.path)
    }

    @Test fun postSendsOriginJsonAndBody() = runTest {
        server.enqueue(MockResponse().setBody("""{"brandId": "brd_1", "following": true, "followers": 12}"""))
        val r: FollowResult = api.post(url("/api/follows"), body = FollowBody("brd_1"))
        assertTrue(r.following)
        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("https://yardstore.space", req.getHeader("Origin"))
        assertTrue(req.getHeader("Content-Type")!!.startsWith("application/json"))
        assertEquals("""{"brandId":"brd_1"}""", req.body.readUtf8())
    }

    @Test fun mapBodiesAndEmptyResponses() = runTest {
        server.enqueue(MockResponse().setResponseCode(204))
        api.send(HTTPMethod.PATCH, url("/api/cart/lines/v1"), body = mapOf("qty" to 2, "note" to null))
        assertEquals("""{"qty":2,"note":null}""", server.takeRequest().body.readUtf8())
        server.enqueue(MockResponse().setBody(""))
        val empty: EmptyResponse = api.delete(url("/api/cart"))
        assertTrue(empty is EmptyResponse)
    }

    @Test fun errorsUseServerMessage() = runTest {
        server.enqueue(MockResponse().setResponseCode(409).setBody("""{"error":{"code":"conflict","message":"Only 1 left."}}"""))
        try {
            api.send(HTTPMethod.POST, url("/api/cart/lines"), body = mapOf("variantId" to "v", "qty" to 3))
            fail("expected APIError")
        } catch (e: APIError) {
            assertEquals(409, e.status)
            assertEquals("Only 1 left.", e.message)
        }
    }

    @Test fun decodingFailureIsAPIError() = runTest {
        server.enqueue(MockResponse().setBody("""{"products": "nope"}"""))
        try {
            api.get<ProductsPage>(url("/api/catalog/products"))
            fail("expected APIError")
        } catch (e: APIError) {
            assertEquals("decoding", e.code)
        }
    }

    @Test fun cookiesPersistAcrossRequests() = runTest {
        server.enqueue(MockResponse().addHeader("Set-Cookie", "yard_s=abc; Path=/; HttpOnly").setBody("{}"))
        server.enqueue(MockResponse().setBody("{}"))
        api.send(HTTPMethod.POST, url("/api/auth/sign-in"))
        api.send(HTTPMethod.GET, url("/api/session"))
        server.takeRequest()
        assertEquals("yard_s=abc", server.takeRequest().getHeader("Cookie"))
    }
}
