package space.yardstore.app.features.brands

import kotlinx.coroutines.delay
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.PersistentCookieJar
import java.util.concurrent.CopyOnWriteArrayList

/** A MockWebServer that answers by path, plus an APIClient whose relative paths are sent to it. */
class BrandsTestServer {
    val server = MockWebServer()
    val requests = CopyOnWriteArrayList<RecordedRequest>()
    /** path (without query) → response factory. */
    val routes = mutableMapOf<String, (RecordedRequest) -> MockResponse>()

    lateinit var api: APIClient
        private set

    fun start() {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                requests += request
                val path = request.requestUrl?.encodedPath ?: ""
                return routes[path]?.invoke(request)
                    ?: MockResponse().setResponseCode(404).setBody("""{"error":{"code":"not_found","message":"Not found."}}""")
            }
        }
        server.start()
        val base = server.url("/")
        val http = APIClient.buildHttpClient(PersistentCookieJar(null)).newBuilder()
            .addInterceptor { chain ->
                val original = chain.request()
                val url = original.url.newBuilder().scheme(base.scheme).host(base.host).port(base.port).build()
                chain.proceed(original.newBuilder().url(url).build())
            }
            .build()
        api = APIClient(http)
    }

    fun shutdown() = server.shutdown()

    fun json(path: String, body: String, code: Int = 200) {
        routes[path] = { MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body) }
    }

    fun requestsTo(path: String): List<RecordedRequest> = requests.filter { it.requestUrl?.encodedPath == path }
}

suspend fun brandsWaitUntil(timeoutMs: Long = 5000, condition: () -> Boolean) {
    val start = System.currentTimeMillis()
    while (!condition()) {
        if (System.currentTimeMillis() - start > timeoutMs) throw AssertionError("Timed out waiting")
        delay(10)
    }
}

object BrandsJson {
    fun product(id: String, mediaId: String = "m_$id") = """
        {"id": "$id", "slug": "piece-$id", "brandId": "brd_1", "title": "Boxy tee $id", "priceMinor": 4500, "currency": "USD",
         "images": [{"id": "img_$id", "src": "/api/media/$mediaId", "alt": "", "width": 800, "height": 1000, "mediaId": "$mediaId"}],
         "variants": [{"id": "var_$id", "label": "Size M", "priceMinor": 4500, "available": 3}], "available": 3,
         "publishedAt": "2026-11-01T10:00:00.000Z", "brand": {"id": "brd_1", "handle": "acme", "name": "Acme Studio"}}
    """.trimIndent()

    fun productsPage(ids: List<String>, total: Int, nextOffset: Int?) =
        """{"products": [${ids.joinToString(",") { product(it) }}], "total": $total, "nextOffset": ${nextOffset ?: "null"}}"""

    fun storefront(story: String? = "Heavyweight basics cut and sewn in Lagos.", intro: String = "Basics from Lagos.", coverMediaId: String? = "cover1", forSale: Boolean = true) = """
        {"brand": {"id": "brd_1", "handle": "acme", "name": "Acme Studio", "city": "Lagos", "citySlug": "lagos", "country": "NG",
                   "currency": "NGN", "categories": ["streetwear", "fashion"], "verified": true, "reviewStatus": "verified",
                   "joinedAt": "2026-01-01T00:00:00.000Z", "followersBase": 0, "timeZone": "Africa/Lagos", "foundingBadge": true,
                   "forSale": $forSale, "logoSrc": "/api/media/logo1", "story": ${story?.let { "\"$it\"" } ?: "null"}},
         "storefront": {"version": 3, "publishedAt": "2026-10-01T00:00:00.000Z",
                        "config": {"template": "editorial", "accent": "acid", "typePreset": "condensed", "intro": "$intro",
                                   "announcement": {"text": "Summer drop Friday", "href": "/drops/summer"}, "sections": [],
                                   "coverMediaId": ${coverMediaId?.let { "\"$it\"" } ?: "null"}}},
         "collections": [{"id": "col_1", "handle": "core", "name": "Core", "description": "Always made.", "imageSrc": null, "imageMediaId": "m9", "productIds": ["p1", "p2"]}]}
    """.trimIndent()

    fun drop(id: String, phase: String, brandId: String = "brd_1") = """
        {"id": "$id", "slug": "drop-$id", "brand": {"id": "$brandId", "handle": "acme", "name": "Acme Studio"}, "name": "Drop $id",
         "access": "draw", "status": "scheduled", "phase": "$phase", "startsAt": "2026-12-01T10:00:00.000Z", "endsAt": "2026-12-02T10:00:00.000Z",
         "limitPerCustomer": 1, "totalUnits": 50, "productIds": ["p1"], "sponsored": false}
    """.trimIndent()

    fun dropsPage(drops: List<String>, nextCursor: String? = null) =
        """{"items": [${drops.joinToString(",")}], "nextCursor": ${nextCursor?.let { "\"$it\"" } ?: "null"}}"""

    fun brandCard(id: String, categories: List<String>, founding: Boolean = false) = """
        {"id": "$id", "handle": "h-$id", "name": "Brand $id", "city": "Accra", "country": "GH",
         "categories": [${categories.joinToString(",") { "\"$it\"" }}], "story": null, "logoSrc": null, "coverSrc": "/api/media/c_$id",
         "verified": false, "founding": $founding, "foundingBadge": $founding, "forSale": true, "listedAt": "2026-02-01T00:00:00Z"}
    """.trimIndent()

    fun brandsPage(cards: List<String>, total: Int, nextOffset: Int?) =
        """{"brands": [${cards.joinToString(",")}], "total": $total, "nextOffset": ${nextOffset ?: "null"}}"""
}
